import Image from "next/image";
import Link from "next/link";

/** The full Sai Ping logo (mascot + wordmark), linking home. */
export function BrandLogo({ height = 44 }: { height?: number }) {
  // Source image is 1145×416
  const width = Math.round((height * 1145) / 416);
  return (
    <Link className="brand-logo" href="/" aria-label="Sai Ping home">
      <Image
        src="/brand/sai-ping-logo.png"
        alt="Sai Ping"
        width={width}
        height={height}
        priority
      />
    </Link>
  );
}
