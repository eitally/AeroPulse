import crypto from 'node:crypto';
import type { FieldEventCode, FieldEventLogRecord } from '../src/types.ts';
import { getFieldEventSpec } from '../src/physiology/fieldEventsEngine.ts';
import {
  buildExternalFieldEventLogRecord,
  isDuplicateExternalFieldLog,
  normalizeAthleteMatchKey,
  type ParsedExternalMeetResultRow,
} from '../src/utils/athleticNetAndTfrrsEngine.ts';
import type { StoredTeamDocument } from './teamStoreCore.ts';

export interface MatchedExternalFieldMarkInput {
  row: ParsedExternalMeetResultRow;
  mem?: {
    membershipId: string;
    invitedName: string;
  };
  membershipId?: string;
  matchedAthleteName?: string;
  athleteName?: string;
}

/**
 * Persists parsed external field results (jumps, vaults, throws) directly as deduplicated
 * competition FieldEventLogRecord entries without synthesizing running VDOT activities.
 */
export function applyParsedExternalFieldMarksToDoc(params: {
  doc: StoredTeamDocument;
  existingLogs?: FieldEventLogRecord[];
  matchedFieldItems: MatchedExternalFieldMarkInput[];
}): {
  addedRecords: FieldEventLogRecord[];
  mergedLogs: FieldEventLogRecord[];
  addedCount: number;
} {
  const baseLogs: FieldEventLogRecord[] = Array.isArray(params.existingLogs)
    ? [...params.existingLogs]
    : Array.isArray(params.doc.fieldMarkLogs)
      ? [...params.doc.fieldMarkLogs]
      : [];

  const mergedLogs: FieldEventLogRecord[] = [...baseLogs];
  const addedRecords: FieldEventLogRecord[] = [];
  const nowIso = new Date().toISOString();

  for (const item of params.matchedFieldItems || []) {
    const row = item?.row;
    if (!row || !row.isFieldEvent) continue;

    const normName = normalizeAthleteMatchKey(row.athleteName);
    const fallbackMem =
      !item.mem && !item.membershipId
        ? (params.doc.memberships || []).find(
            (m) =>
              m.status !== 'REVOKED' &&
              m.role !== 'PARENT_FOLLOWER' &&
              ((row.externalAthleteId && m.externalAthleteId === row.externalAthleteId) ||
                (Boolean(normName) && normalizeAthleteMatchKey(m.invitedName) === normName))
          )
        : undefined;

    const membershipId = item.mem?.membershipId || item.membershipId || fallbackMem?.membershipId;
    const athleteName =
      item.mem?.invitedName ||
      item.matchedAthleteName ||
      item.athleteName ||
      fallbackMem?.invitedName ||
      row.athleteName;

    const eventCode: FieldEventCode = row.fieldEventCode || 'LJ';
    const candidate = buildExternalFieldEventLogRecord({
      row,
      teamId: params.doc.brand.teamId,
      membershipId,
      athleteName,
      nowIso,
      idSuffix: crypto.randomBytes(4).toString('hex'),
    });

    const isDup = mergedLogs.some((existing) =>
      isDuplicateExternalFieldLog(existing, candidate)
    );
    if (isDup) continue;

    if (fallbackMem && !fallbackMem.eventGroup) {
      fallbackMem.eventGroup = getFieldEventSpec(eventCode).eventGroup;
    }

    mergedLogs.unshift(candidate);
    addedRecords.push(candidate);
  }

  params.doc.fieldMarkLogs = mergedLogs;
  params.doc.fieldMarkLogsTotalCount = mergedLogs.length;

  return {
    addedRecords,
    mergedLogs,
    addedCount: addedRecords.length,
  };
}
