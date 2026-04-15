'use client';

import { useState } from 'react';

export default function ProtocolIcon({ slug }: { slug: string }) {
  const [src, setSrc] = useState(`https://icons.llama.fi/${slug}.jpg`);
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;

  return (
    <img
      src={src}
      alt={slug}
      className="w-5 h-5 rounded-full object-cover flex-shrink-0 bg-black/30 ring-1 ring-white/10"
      onError={() => {
        if (src.endsWith('.jpg')) setSrc(`https://icons.llama.fi/${slug}.png`);
        else setHidden(true);
      }}
    />
  );
}
