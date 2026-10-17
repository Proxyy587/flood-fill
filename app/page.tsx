import { GeographyApp } from '../src/shell/geography/GeographyApp';

/** Client atlas shell — skip Instant Navigation validation for this segment. */
export const instant = false;

export default function Home() {
  return <GeographyApp />;
}
