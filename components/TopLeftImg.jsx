import Image from "next/image";
import { assetPath } from "../utils/assetPath";

const TopLeftImg = () => {
  return (
    <div className="absolute left-0 top-0 mix-blend-color-dodge z-10 w-[200px] xl:w-[400px] opacity-50 pointer-events-none select-none">
      <Image
        src={assetPath("/top-left-img.webp")}
        alt=""
        aria-hidden
        width={411}
        height={405}
        style={{ width: "100%", height: "auto" }}
      />
    </div>
  );
};

export default TopLeftImg;