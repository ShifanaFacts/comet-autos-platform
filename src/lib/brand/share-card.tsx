import { ImageResponse } from 'next/og';

/*
 * The picture WhatsApp shows above a shared customer link. A WhatsApp
 * message opened from the app can't carry real buttons (those need the paid
 * WhatsApp Business API), but it does show this link preview — so the
 * preview is drawn as the button: who it is from, the document and its
 * amount, and a big pill with a pointing hand and an arrow — "tap here,
 * it opens" — under a line saying the link is private.
 *
 * Icons are inline SVG (Lucide's shapes), so the picture is drawn without
 * fetching any font or emoji image.
 */

export const SHARE_CARD_SIZE = { width: 1200, height: 630 };

const VIOLET = '#7c3aed';

function Icon({ size, stroke, children }: { size: number; stroke: string; children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** A hand pointing up — "tap". */
const Hand = ({ size, stroke }: { size: number; stroke: string }) => (
  <Icon size={size} stroke={stroke}>
    <path d="M22 14a8 8 0 0 1-8 8" />
    <path d="M18 11v-1a2 2 0 0 0-2-2a2 2 0 0 0-2 2" />
    <path d="M14 10V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1" />
    <path d="M10 9.5V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v10" />
    <path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
  </Icon>
);

const Arrow = ({ size, stroke }: { size: number; stroke: string }) => (
  <Icon size={size} stroke={stroke}>
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </Icon>
);

const Lock = ({ size, stroke }: { size: number; stroke: string }) => (
  <Icon size={size} stroke={stroke}>
    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </Icon>
);

export function shareCard(card: {
  workshop: string;
  /** "Quotation EST-0012" */
  heading: string | null;
  amountLabel: string | null;
  amount: string | null;
  /** "View & approve" */
  button: string;
  /** A short state under the heading: "Waiting for your approval", "Paid in full". */
  status?: { text: string; tone: 'waiting' | 'done' } | null;
}) {
  const statusColor = card.status?.tone === 'done' ? '#34d399' : '#fbbf24';
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '56px 72px 60px',
        background: 'linear-gradient(160deg, #17132a 0%, #111118 55%, #0d0d12 100%)',
        color: '#f8f8fa',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <div
          style={{
            width: 76,
            height: 76,
            borderRadius: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, #a78bfa 0%, #7c3aed 55%, #6d28d9 100%)',
            fontSize: 42,
          }}
        >
          {card.workshop.trim().charAt(0).toUpperCase() || 'C'}
        </div>
        <div style={{ fontSize: 38, color: 'rgba(248,248,250,0.88)' }}>{card.workshop}</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {card.heading ? <div style={{ fontSize: 54 }}>{card.heading}</div> : null}
        {card.status ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 30, color: statusColor }}>
            <div style={{ width: 16, height: 16, borderRadius: 8, background: statusColor }} />
            {card.status.text}
          </div>
        ) : null}
        {card.amount ? (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 20 }}>
            <div style={{ fontSize: 32, color: 'rgba(248,248,250,0.6)' }}>{card.amountLabel}</div>
            <div style={{ fontSize: 74, letterSpacing: '-0.02em' }}>{card.amount}</div>
          </div>
        ) : null}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: 116,
            padding: '0 18px 0 40px',
            borderRadius: 58,
            background: `linear-gradient(180deg, #8b5cf6 0%, ${VIOLET} 100%)`,
            boxShadow: '0 18px 40px rgba(124, 58, 237, 0.45)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 22, fontSize: 46 }}>
            <Hand size={52} stroke="#ffffff" />
            {card.button}
          </div>
          <div
            style={{
              width: 84,
              height: 84,
              borderRadius: 42,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#ffffff',
            }}
          >
            <Arrow size={44} stroke={VIOLET} />
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            fontSize: 24,
            color: 'rgba(248,248,250,0.55)',
          }}
        >
          <Lock size={24} stroke="rgba(248,248,250,0.55)" />
          A private link for you — opens securely, no app needed
        </div>
      </div>
    </div>,
    {
      ...SHARE_CARD_SIZE,
      // The card names a document and its amount: never kept by a shared cache.
      headers: { 'Cache-Control': 'private, no-store' },
    },
  );
}
