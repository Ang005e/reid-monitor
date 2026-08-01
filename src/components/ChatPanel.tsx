import { useEffect, useRef, useState } from 'react';
import type { MonitorState } from '@/state/useMonitor';
import { buildContext, sendChat, type ChatMessage } from '@/services/chat';

/**
 * Community-facing chat. The first message sent carries a snapshot of the last
 * 3 hours of readings plus whatever the rule engine currently says; follow-ups
 * ride on the conversation history, so the context is only paid for once.
 */
export function ChatPanel({ monitor }: { monitor: MonitorState }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, busy]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;

    // First turn only: prepend the live snapshot to what the user typed.
    const content =
      messages.length === 0
        ? `${buildContext(monitor.readings, monitor.interpretations)}\n\n---\n\n${text}`
        : text;

    const outgoing = [...messages, { role: 'user' as const, content }];
    // Display the typed text, not the context-stuffed version.
    setMessages([...messages, { role: 'user', content: text }]);
    setInput('');
    setBusy(true);
    setError(null);

    try {
      const reply = await sendChat(outgoing);
      // Keep the stuffed copy in history so the model retains the snapshot.
      setMessages([...outgoing, { role: 'assistant', content: reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMessages(messages);
      setInput(text);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="chat-fab" onClick={() => setOpen(true)}>
        Ask about the building
      </button>
    );
  }

  return (
    <div className="chat-panel">
      <div className="chat-head">
        <span className="chat-title">Ask about the building</span>
        <button className="chat-close" onClick={() => setOpen(false)} aria-label="Close chat">
          ×
        </button>
      </div>

      <div className="chat-log" ref={scrollRef}>
        {messages.length === 0 && (
          <p className="chat-empty">
            Ask anything about how Reid Library&rsquo;s systems are running right now — the last
            three hours of sensor data comes along with your first question.
          </p>
        )}
        {messages.map((m, i) => (
          // Messages are append-only, so the index is a stable key here.
          <div key={i} className={`chat-msg chat-msg-${m.role}`}>
            {/* Strip the injected snapshot from the first user message. */}
            {m.role === 'user' ? m.content.split('\n\n---\n\n').pop() : m.content}
          </div>
        ))}
        {busy && <div className="chat-msg chat-msg-assistant chat-thinking">Thinking…</div>}
      </div>

      {error && <p className="chat-error">{error}</p>}

      <form className="chat-input-row" onSubmit={submit}>
        <input
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Is everything okay right now?"
          disabled={busy}
          autoFocus
        />
        <button className="btn" type="submit" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
