"use client";

import { JitsiMeeting } from "@jitsi/react-sdk";

interface Props {
  roomName: string;
  token: string;
  onLeave: () => void;
}

/**
 * A plain shared component, not a registered SDUI primitive — mirrors
 * `CommentThread.tsx`'s "internal component, mounted directly" precedent: a
 * video call frame has no meaningful config-driven shape a blueprint node
 * could express. `@jitsi/react-sdk`'s `JitsiMeeting` wraps Jitsi's
 * prebuilt-UI iframe — no custom call UI is built here, deliberately (out
 * of scope for v1, unchanged from the Daily.co-era decision).
 */
export function JitsiCallFrame({ roomName, token, onLeave }: Props) {
  return (
    <JitsiMeeting
      domain={process.env.NEXT_PUBLIC_JITSI_DOMAIN!}
      roomName={roomName}
      jwt={token}
      onReadyToClose={onLeave}
      getIFrameRef={(parentNode) => {
        parentNode.style.height = "100%";
        parentNode.style.width = "100%";
      }}
    />
  );
}
