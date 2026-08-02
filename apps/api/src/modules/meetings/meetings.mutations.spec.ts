import { NotFoundException, ForbiddenException, BadRequestException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import {
  assertMeetingParticipant,
  meetingCreateMutation,
  meetingCancelMutation,
  meetingAddParticipantMutation,
  meetingRemoveParticipantMutation,
  createMeetingGetJoinInfoMutation,
} from "./meetings.mutations";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import type { JitsiService } from "../../integrations/jitsi.service";

function context(grants: string[] = [], userDepartmentId: string | null = null) {
  return { tenantId: "t1", userId: "u1", userDepartmentId, effective: collapsePermissions(grants) };
}

function fakeJitsi(overrides: Partial<Record<keyof JitsiService, jest.Mock>> = {}) {
  return {
    createJoinToken: jest.fn().mockResolvedValue("tok_abc"),
    ...overrides,
  } as unknown as JitsiService;
}

describe("assertMeetingParticipant", () => {
  it("throws NotFoundException when the meeting doesn't exist (or is cancelled)", async () => {
    const tx = { meeting: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(assertMeetingParticipant(tx, context(), "m1")).rejects.toThrow(NotFoundException);
  });

  it("throws ForbiddenException when the meeting exists but the actor isn't a participant", async () => {
    const tx = {
      meeting: { findFirst: jest.fn().mockResolvedValue({ id: "m1" }) },
      meetingParticipant: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaTx;
    await expect(assertMeetingParticipant(tx, context(), "m1")).rejects.toThrow(ForbiddenException);
  });

  it("passes when the actor is a participant", async () => {
    const tx = {
      meeting: { findFirst: jest.fn().mockResolvedValue({ id: "m1" }) },
      meetingParticipant: { findFirst: jest.fn().mockResolvedValue({ id: "p1" }) },
    } as unknown as PrismaTx;
    await expect(assertMeetingParticipant(tx, context(), "m1")).resolves.toEqual({ id: "m1" });
  });
});

describe("meeting.create — input validation", () => {
  it("rejects a scheduledEnd at or before scheduledStart", () => {
    const result = meetingCreateMutation.inputSchema.safeParse({
      title: "x",
      scheduledStart: "2026-08-01T10:00:00Z",
      scheduledEnd: "2026-08-01T10:00:00Z",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a scheduledEnd after scheduledStart", () => {
    const result = meetingCreateMutation.inputSchema.safeParse({
      title: "x",
      scheduledStart: "2026-08-01T10:00:00Z",
      scheduledEnd: "2026-08-01T10:30:00Z",
    });
    expect(result.success).toBe(true);
  });
});

describe("meeting.create", () => {
  it("throws ForbiddenException when the actor has no meeting:create grant at all", async () => {
    const tx = {} as unknown as PrismaTx;
    await expect(
      meetingCreateMutation.resolve({ title: "x", scheduledStart: new Date(), scheduledEnd: new Date(Date.now() + 3600_000), participantIds: [] }, context([]), tx),
    ).rejects.toThrow(ForbiddenException);
  });

  it("rejects inviting a participant outside the organizer's granted scope", async () => {
    const tx = { user: { findMany: jest.fn().mockResolvedValue([{ id: "u2", departmentId: "d2" }]) } } as unknown as PrismaTx;
    await expect(
      meetingCreateMutation.resolve(
        { title: "x", scheduledStart: new Date(), scheduledEnd: new Date(Date.now() + 3600_000), participantIds: ["u2"] },
        context(["meeting:create:team"], "d1"), // caller is in d1, candidate is in d2
        tx,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it("generates a room name, creates the meeting, adds the organizer + valid participants, and notifies only the invitees (not the organizer)", async () => {
    const tx = {
      user: { findMany: jest.fn().mockResolvedValue([{ id: "u2", departmentId: "d1" }]) },
      meeting: { create: jest.fn().mockResolvedValue({ id: "m1", title: "Standup" }) },
      meetingParticipant: { create: jest.fn().mockResolvedValue({}) },
      notification: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaTx;

    await meetingCreateMutation.resolve(
      { title: "Standup", scheduledStart: new Date(), scheduledEnd: new Date(Date.now() + 3600_000), participantIds: ["u2"] },
      context(["meeting:create:team"], "d1"),
      tx,
    );

    const mocks = tx as unknown as { meeting: { create: jest.Mock }; meetingParticipant: { create: jest.Mock }; notification: { create: jest.Mock } };
    expect(mocks.meeting.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ videoRoomName: expect.stringMatching(/^mtg-/) }) }));
    expect(mocks.meetingParticipant.create).toHaveBeenCalledTimes(2);
    expect(mocks.meetingParticipant.create).toHaveBeenCalledWith({ data: { tenantId: "t1", meetingId: "m1", userId: "u1" } });
    expect(mocks.meetingParticipant.create).toHaveBeenCalledWith({ data: { tenantId: "t1", meetingId: "m1", userId: "u2" } });
    expect(mocks.notification.create).toHaveBeenCalledTimes(1);
    expect(mocks.notification.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: "u2", type: "meeting.invited" }) }));
  });
});

describe("meeting.cancel", () => {
  it("throws NotFoundException if the meeting doesn't exist", async () => {
    const tx = { meeting: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(meetingCancelMutation.resolve({ id: "m1" }, context(), tx)).rejects.toThrow(NotFoundException);
  });

  it("throws ForbiddenException if the actor isn't the organizer", async () => {
    const tx = { meeting: { findFirst: jest.fn().mockResolvedValue({ id: "m1", organizerId: "someone-else" }) } } as unknown as PrismaTx;
    await expect(meetingCancelMutation.resolve({ id: "m1" }, context(), tx)).rejects.toThrow(ForbiddenException);
  });

  it("cancels — no external cleanup call, unlike the Daily-era version (Jitsi has no per-room resource to delete)", async () => {
    const tx = {
      meeting: {
        findFirst: jest.fn().mockResolvedValue({ id: "m1", organizerId: "u1", videoRoomName: "mtg-m1" }),
        update: jest.fn().mockResolvedValue({ id: "m1", cancelledAt: new Date() }),
      },
    } as unknown as PrismaTx;

    await meetingCancelMutation.resolve({ id: "m1" }, context(), tx);

    expect((tx as unknown as { meeting: { update: jest.Mock } }).meeting.update).toHaveBeenCalledWith({ where: { id: "m1" }, data: { cancelledAt: expect.any(Date) } });
  });
});

describe("meeting.addParticipant", () => {
  it("throws ForbiddenException if the actor isn't the organizer", async () => {
    const tx = { meeting: { findFirst: jest.fn().mockResolvedValue({ id: "m1", organizerId: "someone-else" }) } } as unknown as PrismaTx;
    await expect(meetingAddParticipantMutation.resolve({ meetingId: "m1", userId: "u2" }, context(["meeting:create:tenant"]), tx)).rejects.toThrow(ForbiddenException);
  });

  it("rejects when the candidate is outside the organizer's granted scope", async () => {
    const tx = {
      meeting: { findFirst: jest.fn().mockResolvedValue({ id: "m1", organizerId: "u1" }) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: "u2", departmentId: "d2" }]) },
    } as unknown as PrismaTx;
    await expect(meetingAddParticipantMutation.resolve({ meetingId: "m1", userId: "u2" }, context(["meeting:create:team"], "d1"), tx)).rejects.toThrow(ForbiddenException);
  });

  it("is idempotent — adding an existing participant is a no-op, no duplicate notification", async () => {
    const tx = {
      meeting: { findFirst: jest.fn().mockResolvedValue({ id: "m1", title: "Standup", organizerId: "u1" }) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: "u2", departmentId: "d1" }]) },
      meetingParticipant: { findFirst: jest.fn().mockResolvedValue({ id: "p1" }), create: jest.fn() },
      notification: { create: jest.fn() },
    } as unknown as PrismaTx;

    await meetingAddParticipantMutation.resolve({ meetingId: "m1", userId: "u2" }, context(["meeting:create:team"], "d1"), tx);

    const mocks = tx as unknown as { meetingParticipant: { create: jest.Mock }; notification: { create: jest.Mock } };
    expect(mocks.meetingParticipant.create).not.toHaveBeenCalled();
    expect(mocks.notification.create).not.toHaveBeenCalled();
  });

  it("adds a genuinely new participant and notifies them", async () => {
    const tx = {
      meeting: { findFirst: jest.fn().mockResolvedValue({ id: "m1", title: "Standup", organizerId: "u1" }) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: "u2", departmentId: "d1" }]) },
      meetingParticipant: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
      notification: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaTx;

    await meetingAddParticipantMutation.resolve({ meetingId: "m1", userId: "u2" }, context(["meeting:create:team"], "d1"), tx);

    const mocks = tx as unknown as { meetingParticipant: { create: jest.Mock }; notification: { create: jest.Mock } };
    expect(mocks.meetingParticipant.create).toHaveBeenCalledWith({ data: { tenantId: "t1", meetingId: "m1", userId: "u2" } });
    expect(mocks.notification.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: "u2", type: "meeting.invited" }) }));
  });
});

describe("meeting.removeParticipant", () => {
  it("throws ForbiddenException if the actor isn't the organizer", async () => {
    const tx = { meeting: { findFirst: jest.fn().mockResolvedValue({ id: "m1", organizerId: "someone-else" }) } } as unknown as PrismaTx;
    await expect(meetingRemoveParticipantMutation.resolve({ meetingId: "m1", userId: "u2" }, context(), tx)).rejects.toThrow(ForbiddenException);
  });

  it("rejects removing the organizer", async () => {
    const tx = { meeting: { findFirst: jest.fn().mockResolvedValue({ id: "m1", organizerId: "u1" }) } } as unknown as PrismaTx;
    await expect(meetingRemoveParticipantMutation.resolve({ meetingId: "m1", userId: "u1" }, context(), tx)).rejects.toThrow(BadRequestException);
  });

  it("removes a genuine participant", async () => {
    const tx = {
      meeting: { findFirst: jest.fn().mockResolvedValue({ id: "m1", organizerId: "u1" }) },
      meetingParticipant: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    } as unknown as PrismaTx;

    await meetingRemoveParticipantMutation.resolve({ meetingId: "m1", userId: "u2" }, context(), tx);

    expect((tx as unknown as { meetingParticipant: { deleteMany: jest.Mock } }).meetingParticipant.deleteMany).toHaveBeenCalledWith({ where: { meetingId: "m1", userId: "u2" } });
  });
});

describe("meeting.getJoinInfo", () => {
  it("throws ForbiddenException when the actor isn't a participant", async () => {
    const mutation = createMeetingGetJoinInfoMutation(fakeJitsi());
    const tx = {
      meeting: { findFirst: jest.fn().mockResolvedValue({ id: "m1" }) },
      meetingParticipant: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaTx;
    await expect(mutation.resolve({ meetingId: "m1" }, context(), tx)).rejects.toThrow(ForbiddenException);
  });

  it("returns a fresh Jitsi token for a genuine participant", async () => {
    const jitsi = fakeJitsi();
    const mutation = createMeetingGetJoinInfoMutation(jitsi);
    const tx = {
      meeting: { findFirst: jest.fn().mockResolvedValue({ id: "m1", organizerId: "u1", videoRoomName: "mtg-m1" }) },
      meetingParticipant: { findFirst: jest.fn().mockResolvedValue({ id: "p1" }) },
      user: { findFirst: jest.fn().mockResolvedValue({ id: "u1", displayName: "Deep", email: "deep@example.com" }) },
    } as unknown as PrismaTx;

    const result = await mutation.resolve({ meetingId: "m1" }, context(), tx);

    expect(jitsi.createJoinToken).toHaveBeenCalledWith("mtg-m1", { id: "u1", name: "Deep", email: "deep@example.com" }, { isModerator: true, exp: expect.any(Number) });
    expect(result).toEqual({ roomName: "mtg-m1", token: "tok_abc", isOwner: true });
  });
});
