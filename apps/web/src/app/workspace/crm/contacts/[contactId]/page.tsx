"use client";

import { useParams } from "next/navigation";
import { ContactDetail } from "../../../../../modules/crm/ContactDetail";

export default function ContactDetailPage() {
  const params = useParams<{ contactId: string }>();
  return <ContactDetail contactId={params.contactId} />;
}
