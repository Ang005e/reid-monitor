/**
 * Direct browser → Anthropic Messages API call.
 *
 * HACKATHON SHORTCUT: the key is hardcoded and therefore public to anyone who
 * opens devtools. Rotate it after the demo and move this behind a backend route
 * (`POST /api/chat`) before this goes anywhere real.
 */
import type { Interpretation, SensorReading } from '@/types';

const API_KEY =
  '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';
const MODEL = 'claude-sonnet-4-6';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Readings are hourly, so "the latest 3 hours" is the last 3 rows. */
const CONTEXT_HOURS = 3;

/**
 * Snapshot of the last few hours, injected once as a preamble on the first
 * user message. Kept as plain text — the model reads it fine and it costs
 * far less than shipping the whole rolling window.
 */
export function buildContext(
  readings: SensorReading[],
  interpretations: Interpretation[],
): string {
  const recent = readings.slice(-CONTEXT_HOURS);
  const rows = recent
    .map((r) => {
      const n = (v: number | null, p = 2) => (v == null ? 'no reading' : v.toFixed(p));
      return [
        `- ${r.timestamp} (status: ${r.system_status}, sound: ${r.sound_event})`,
        `  power ${n(r.power_kw)} kW, airflow ${n(r.airflow_m3s, 3)} m³/s,`,
        `  water pressure ${n(r.water_pressure_kpa, 1)} kPa, water flow ${n(r.water_flow_lps)} L/s,`,
        `  temperature ${n(r.temperature_c, 1)} °C, vibration ${n(r.vibration_level, 3)}`,
        r.derived_alert ? `  pipeline classification: ${r.derived_alert}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

  const findings = interpretations.length
    ? interpretations
        .map((i) => `- [${i.severity}] ${i.title}: ${i.engineerDetail} (suggested action: ${i.action})`)
        .join('\n')
    : '- Nothing currently firing; all monitored patterns look normal.';

  return [
    `Here is the live state of the Reid Library building systems.`,
    ``,
    `Last ${recent.length} hourly readings:`,
    rows || '- No readings available yet.',
    ``,
    `Current findings from the monitoring rule engine:`,
    findings,
  ].join('\n');
}

const SYSTEM_PROMPT = [
  'You are the assistant for the Reid Library building-systems dashboard at UWA.',
  'You are talking to a community member — a student, librarian, or visitor — not an engineer.',
  'Explain what the building is doing in plain, calm language. Avoid jargon; if you must use a',
  'number, say what a normal one looks like. Be honest when something needs attention, and say',
  'who they should tell. Keep answers to a few short sentences unless asked for more.',
  'Only discuss the building and its sensors. If the data does not answer the question, say so.',
].join(' ');

export async function sendChat(messages: ChatMessage[]): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      // Required for calls made straight from a browser.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = (data.content ?? [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('\n')
    .trim();

  return text || 'No response.';
}
