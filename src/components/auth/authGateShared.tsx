import React from 'react';

export const StravaChevronMark: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
    <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
  </svg>
);

export const SEED_EVENT_PILLS: Array<{
  id: string;
  label: string;
  sport: 'Running' | 'Cycling';
  prefix: string;
  placeholder: string;
}> = [
  { id: '5k', label: '5K Race', sport: 'Running', prefix: '5K ', placeholder: 'e.g. 18:45' },
  { id: '3200m', label: '3200m', sport: 'Running', prefix: '3200m ', placeholder: 'e.g. 10:15' },
  { id: '1600m', label: '1600m / Mile', sport: 'Running', prefix: '1600m ', placeholder: 'e.g. 4:52' },
  { id: '800m', label: '800m', sport: 'Running', prefix: '800m ', placeholder: 'e.g. 2:04' },
  { id: 'ftp', label: 'Known FTP', sport: 'Cycling', prefix: '', placeholder: 'e.g. 265W' },
  { id: '20m', label: '20m Power', sport: 'Cycling', prefix: '20m ', placeholder: 'e.g. 280W' },
];
