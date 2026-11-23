import React, { useMemo, useRef, useState } from 'react';
import {
  Globe,
  RefreshCw,
  Send,
  Upload,
} from '../icons/PhosphorIcons';
import type { TeamOrgType, TeamSummaryWithRole } from '../../types';
import { parseBulkRosterCsvOrText } from '../../physiology/teamOnboardingEngine';
import { buildThreshSessionHeaders } from '../../utils/teamLifecycleApi';

export interface TeamBulkRosterImporterProps {
  activeTeam: TeamSummaryWithRole;
  myTeams: TeamSummaryWithRole[];
  orgType: TeamOrgType;
  defaultSquadForImport: string;
  originUrl: string;
  resendConfigured: boolean;
  isSendingBulk: boolean;
  setIsSendingBulk: React.Dispatch<React.SetStateAction<boolean>>;
  onTeamsUpdated: (teams: TeamSummaryWithRole[], nextActiveTeamId?: string | null) => void;
  onOpenExternalSync?: () => void;
  onBannerMessage: (msg: { tone: 'success' | 'info' | 'error'; text: string } | null) => void;
}

export const TeamBulkRosterImporter: React.FC<TeamBulkRosterImporterProps> = ({
  activeTeam,
  myTeams,
  orgType,
  defaultSquadForImport,
  originUrl,
  resendConfigured,
  isSendingBulk,
  setIsSendingBulk,
  onTeamsUpdated,
  onOpenExternalSync,
  onBannerMessage,
}) => {
  const [rawRosterInput, setRawRosterInput] = useState('');
  const csvFileInputRef = useRef<HTMLInputElement | null>(null);

  const parsedRosterPreview = useMemo(
    () =>
      parseBulkRosterCsvOrText(
        rawRosterInput,
        activeTeam?.brand.orgType || orgType,
        defaultSquadForImport
      ),
    [rawRosterInput, activeTeam?.brand.orgType, orgType, defaultSquadForImport]
  );

  const handleSendBulkInvites = async () => {
    if (!activeTeam || parsedRosterPreview.length === 0) return;
    setIsSendingBulk(true);
    onBannerMessage(null);
    try {
      const resp = await fetch(
        `/api/teams/${encodeURIComponent(activeTeam.brand.teamId)}/invites/bulk`,
        {
          method: 'POST',
          credentials: 'include',
          headers: buildThreshSessionHeaders(),
          body: JSON.stringify({
            origin: originUrl,
            rows: parsedRosterPreview,
            sendEmailsNow: true,
          }),
        }
      );
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        onBannerMessage({
          tone: 'error',
          text: data.error || 'Failed to add roster invites.',
        });
        return;
      }
      const updatedTeam = data.team as TeamSummaryWithRole;
      onTeamsUpdated(
        myTeams.map((t) =>
          t.brand.teamId === updatedTeam.brand.teamId ? updatedTeam : t
        ),
        updatedTeam.brand.teamId
      );
      setRawRosterInput('');
      onBannerMessage({
        tone: 'success',
        text: data.emailedCount > 0
          ? `Added ${data.addedCount} athletes and dispatched ${data.emailedCount} branded invite email(s).`
          : `Added ${data.addedCount} athletes with personalized Magic Join Links ready to copy, text (SMS), or email!`,
      });
    } catch {
      onBannerMessage({
        tone: 'error',
        text: 'Network error sending bulk roster invites.',
      });
    } finally {
      setIsSendingBulk(false);
    }
  };

  return (
    <div className="rounded-2xl liquid-glass border border-stone-200/90 dark:border-white/10 p-4 sm:p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-bold text-slate-900 dark:text-white">
            Invite or Import Athletes (CSV, Email or SMS)
          </h4>
          <span
            className={`px-2 py-0.5 rounded text-2xs font-mono font-bold ${
              resendConfigured ? 'ap-status-prime' : 'ap-status-info'
            }`}
          >
            {resendConfigured
              ? 'Direct Email Active'
              : 'Magic Link, Email & SMS Ready'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onOpenExternalSync && (
            <button
              type="button"
              onClick={onOpenExternalSync}
              className="min-h-[44px] sm:min-h-[36px] px-3 py-1.5 rounded-xl bg-white dark:bg-ap-carbon border border-stone-300 dark:border-ap-edge text-xs font-semibold text-slate-800 dark:text-slate-100 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5 text-ap-cobalt dark:text-ap-volt" />
              <span>Athletic.net / TFRRS Sync</span>
            </button>
          )}
          <input
            ref={csvFileInputRef}
            type="file"
            aria-label="Upload roster CSV or text file"
            accept=".csv,.tsv,.txt"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => setRawRosterInput(String(reader.result || ''));
              reader.readAsText(file);
            }}
          />
          <button
            type="button"
            onClick={() => csvFileInputRef.current?.click()}
            className="min-h-[44px] sm:min-h-[36px] px-3 py-1.5 rounded-xl bg-stone-200/70 dark:bg-slate-800 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload .CSV</span>
          </button>

          <button
            type="button"
            onClick={() =>
              setRawRosterInput(
                [
                  'Name, Email, Phone, Squad, GradYear, ParentEmail, SeedMark',
                  'Liam OConnor, liam.xc@example.edu, 650-555-0142, Varsity, 2027, parent.oconnor@example.com, 16:48 5K',
                  'Sofia Martinez, sofia.run@example.edu, 650-555-0188, Varsity, 2028, parent.martinez@example.com, 5:09 1600m',
                  'Ethan Patel, ethan.jv@example.edu, 650-555-0194, Junior Varsity, 2029, parent.patel@example.com, 19:15 5K',
                ].join('\n')
              )
            }
            className="min-h-[44px] sm:min-h-[36px] px-3 py-1.5 rounded-xl bg-stone-200/70 dark:bg-slate-800 text-xs font-mono cursor-pointer"
          >
            Sample CSV
          </button>
        </div>
      </div>

      <textarea
        rows={3}
        value={rawRosterInput}
        aria-label="Paste spreadsheet rows or athlete email list for roster import"
        onChange={(e) => setRawRosterInput(e.target.value)}
        placeholder={`Name, Email, Phone, Squad, GradYear, ParentEmail, SeedMark\nMaya Chen, maya@school.edu, 650-555-0119, Varsity, 2027, parent@family.com, 18:05 5K`}
        className="w-full rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-ap-turf p-3 text-xs font-mono text-slate-900 dark:text-slate-100"
      />

      {parsedRosterPreview.length > 0 && (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-xl border border-stone-200 dark:border-slate-800">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-stone-100 dark:bg-ap-carbon text-2xs font-mono uppercase text-slate-500">
                <tr>
                  <th className="py-2 px-3">Athlete</th>
                  <th className="py-2 px-3">Email</th>
                  <th className="py-2 px-3">Phone (SMS)</th>
                  <th className="py-2 px-3">Squad</th>
                  <th className="py-2 px-3">Seed Mark</th>
                  <th className="py-2 px-3">Safeguarding</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200/70 dark:divide-slate-800">
                {parsedRosterPreview.slice(0, 12).map((row, idx) => (
                  <tr key={`${row.invitedName}-${idx}`}>
                    <td className="py-2 px-3 font-semibold">{row.invitedName}</td>
                    <td className="py-2 px-3 font-mono text-2xs">
                      {row.invitedEmail || '—'}
                    </td>
                    <td className="py-2 px-3 font-mono text-2xs">
                      {row.invitedPhone || '—'}
                    </td>
                    <td className="py-2 px-3">{row.squadGroup}</td>
                    <td className="py-2 px-3 font-mono text-2xs text-emerald-700 dark:text-emerald-300">
                      {row.seedMarkOrFtp || 'Auto'}
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex flex-wrap gap-1">
                        {row.isMinorU18 && (
                          <span className="px-1.5 py-0.5 rounded text-2xs font-mono ap-status-prime">
                            Safe-Sport Shield
                          </span>
                        )}
                        {row.parentGuardianEmail && (
                          <span className="px-1.5 py-0.5 rounded text-2xs font-mono ap-status-info">
                            CC: {row.parentGuardianEmail}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-mono text-slate-600 dark:text-slate-300">
              {parsedRosterPreview.length > 12
                ? `Showing 12 of ${parsedRosterPreview.length} preview rows · `
                : ''}
              Ready to import <strong>{parsedRosterPreview.length}</strong> athlete
              {parsedRosterPreview.length === 1 ? '' : 's'} into{' '}
              <strong>{activeTeam.brand.shortName}</strong>
            </span>
            <button
              type="button"
              disabled={isSendingBulk}
              onClick={handleSendBulkInvites}
              className="ap-btn-primary text-xs cursor-pointer"
            >
              {isSendingBulk ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              <span>
                {resendConfigured
                  ? `Import & Email ${parsedRosterPreview.length} Team Invites`
                  : `Import ${parsedRosterPreview.length} Athletes & Generate Magic Links`}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
