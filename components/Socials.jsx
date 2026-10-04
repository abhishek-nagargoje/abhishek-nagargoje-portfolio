"use client";
import { RiGithubLine, RiLinkedinLine, RiMailLine } from "react-icons/ri";
import { personalInfo } from "../data/personalInfo";
export const socialData = [
  {
    name: "GitHub",
    link: personalInfo.github,
    Icon: RiGithubLine,
  },
  {
    name: "LinkedIn",
    link: personalInfo.linkedin,
    Icon: RiLinkedinLine,
  },
  {
    name: "Email",
    link: `mailto:${personalInfo.email}`,
    Icon: RiMailLine,
  },
];

const Socials = () => {
  return (
    <div className="flex items-center gap-x-5 text-lg">
      {socialData.map((social, i) => (
        <a
          key={i}
          title={social.name}
          href={social.link}
          target="_blank"
          rel="noreferrer noopener"
          className={`${
            social.name === "GitHub"
              ? "bg-accent rounded-full p-[5px] hover:text-white"
              : "hover:text-accent"
          } transition-all duration-300`}
        >
          <social.Icon aria-hidden />
          <span className="sr-only">{social.name}</span>
        </a>
      ))}
    </div>
  );
};

export default Socials;
