import type { Incident, Member } from "./types.ts";

export type EscalationCandidate = {
  memberId: string;
  eligible: boolean;
  reasons: string[];
  route: "owner" | "delegate" | "on_call";
};
export type Delegation = {
  id: string;
  fromId: string;
  toId: string;
  startsAt: string;
  endsAt: string;
  capabilities: string[];
  resourceIds: string[];
};
export type EscalationResult = {
  incidentId: string;
  candidates: EscalationCandidate[];
  selectedMemberId?: string;
  approvalBlocked: boolean;
  nextCoverageAt?: string;
};

function localParts(
  date: Date,
  timezone: string,
): { weekday: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    parts.find((p) => p.type === "weekday")?.value ?? "",
  );
  return {
    weekday,
    minute:
      Number(parts.find((p) => p.type === "hour")?.value) * 60 +
      Number(parts.find((p) => p.type === "minute")?.value),
  };
}
const minutes = (value: string) =>
  Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
export function isInWorkingWindow(member: Member, at: Date): boolean {
  if (
    member.leave &&
    at >= new Date(member.leave.startsAt) &&
    at < new Date(member.leave.endsAt)
  )
    return false;
  const local = localParts(at, member.timezone);
  return member.workingHours.some((interval) => {
    const start = minutes(interval.start),
      end = minutes(interval.end);
    if (start <= end)
      return (
        interval.weekday === local.weekday &&
        local.minute >= start &&
        local.minute < end
      );
    return (
      (interval.weekday === local.weekday && local.minute >= start) ||
      ((interval.weekday + 1) % 7 === local.weekday && local.minute < end)
    );
  });
}
export function chooseEscalation(input: {
  incident: Incident;
  members: Member[];
  delegates: Delegation[];
  authorizedApproverIds: Set<string>;
  at: Date;
}): EscalationResult {
  const byId = new Map(input.members.map((m) => [m.id, m]));
  const routes: Array<{ id: string; route: EscalationCandidate["route"] }> = [
    { id: input.incident.commanderId, route: "owner" },
  ];
  for (const d of input.delegates.filter(
    (d) =>
      d.fromId === input.incident.commanderId &&
      d.resourceIds.includes(input.incident.id) &&
      input.at >= new Date(d.startsAt) &&
      input.at < new Date(d.endsAt) &&
      d.capabilities.includes("incident:approve"),
  ))
    routes.push({ id: d.toId, route: "delegate" });
  for (const member of input.members.filter((m) =>
    m.onCallWindows.some(
      (w) =>
        w.accepted &&
        input.at >= new Date(w.startsAt) &&
        input.at < new Date(w.endsAt),
    ),
  ))
    routes.push({ id: member.id, route: "on_call" });
  const seen = new Set<string>();
  const candidates = routes
    .filter((r) => !seen.has(r.id) && seen.add(r.id))
    .map(({ id, route }) => {
      const member = byId.get(id);
      const reasons: string[] = [];
      if (!member?.active) reasons.push("inactive");
      if (
        member?.leave &&
        input.at >= new Date(member.leave.startsAt) &&
        input.at < new Date(member.leave.endsAt)
      )
        reasons.push("on leave");
      const inHours = member ? isInWorkingWindow(member, input.at) : false;
      if (!inHours && !member?.notifications.afterHours)
        reasons.push("after-hours alerts disabled");
      if (!input.authorizedApproverIds.has(id))
        reasons.push("no existing approval permission");
      const availability =
        member?.availabilityUntil &&
        new Date(member.availabilityUntil) <= input.at
          ? "available"
          : member?.availability;
      if (
        member &&
        availability &&
        !["available", "on_call"].includes(availability)
      )
        reasons.push(availability);
      return { memberId: id, eligible: reasons.length === 0, reasons, route };
    });
  const selectedMemberId = candidates.find(
    (candidate) => candidate.eligible,
  )?.memberId;
  return {
    incidentId: input.incident.id,
    candidates,
    ...(selectedMemberId ? { selectedMemberId } : {}),
    approvalBlocked: !selectedMemberId,
  };
}
