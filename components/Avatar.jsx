import Image from "next/image";
import { assetPath } from "../utils/assetPath";

// 920×1380 WebP (~80KB, was a 1.5MB PNG). `priority` only where it is the
// above-the-fold hero image; elsewhere it lazy-loads.
const Avatar = ({ priority = false }) => {
  return (
    <div className="w-full h-full pointer-events-none select-none">
      <Image
        src={assetPath("/avatar.webp")}
        alt="Abhishek Nagargoje"
        width={920}
        height={1380}
        priority={priority}
        className="w-full h-full object-cover object-top"
      />
    </div>
  );
};

export default Avatar;
