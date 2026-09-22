import { markdownToPlainText } from './notes.js';

const DUE_LINE = /^due\s*:\s*(\d{4})-(\d{1,2})-(\d{1,2})$/i;
const MS_PER_DAY = 86400000;

function firstLineOf(value) {
  return String(value ?? '').split(/\r?\n/, 1)[0] || '';
}

export function parseDueDate(value) {
  const match = DUE_LINE.exec(markdownToPlainText(firstLineOf(value)));
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  const valid = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  return valid ? date : null;
}

export function daysUntilDue(due, now = new Date()) {
  if (!(due instanceof Date) || Number.isNaN(due.getTime())) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due.getTime() - today.getTime()) / MS_PER_DAY);
}

export function dueBadgeLabel(days) {
  if (!Number.isInteger(days)) return '';
  if (days === 0) return 'D-DAY';
  return days > 0 ? `D-${days}` : `D+${-days}`;
}

export function dueBadge(value, now = new Date()) {
  const due = parseDueDate(value);
  if (!due) return null;

  const days = daysUntilDue(due, now);
  const month = String(due.getMonth() + 1).padStart(2, '0');
  const day = String(due.getDate()).padStart(2, '0');
  return { days, label: dueBadgeLabel(days), date: `${due.getFullYear()}-${month}-${day}` };
}
