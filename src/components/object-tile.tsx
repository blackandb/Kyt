'use client';

import dynamic from 'next/dynamic';

const Object3D = dynamic(() => import('@/components/object3d'), { ssr: false });

export function ObjectTile({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return (
    <div className={`tile tile-${size}`} aria-hidden>
      <Object3D />
    </div>
  );
}
