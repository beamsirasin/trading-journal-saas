import type { Metadata } from 'next';

import { PrototypeGallery } from '@/components/prototype/prototype-gallery';

export const metadata: Metadata = { title: 'Prototype · TradeChemist redesign' };

/** The review index: every prototype screen, framed at the width it is judged at. */
export default function PrototypeIndexPage() {
  return <PrototypeGallery />;
}
