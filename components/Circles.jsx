import { assetPath } from "../utils/assetPath";

const Circles = () => {
  return (
    <div className="w-[200px] xl:w-[300px] absolute -right-16 -bottom-2 mix-blend-color-dodge animate-pulse duration-75 z-10">
      <img
        loading="lazy"
        decoding="async"
        src={assetPath("/circles.webp")}
        alt=""
        width={260}
        height={200}
        className="w-full h-full"
        aria-hidden="true"
      />
    </div>
  );
};

export default Circles;