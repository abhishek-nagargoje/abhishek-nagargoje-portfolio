"use client";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useRef } from "react";
import { BsArrowRight, BsGithub } from "react-icons/bs";
import { HiOutlineEnvelope, HiOutlineMapPin, HiOutlineArrowDownTray } from "react-icons/hi2";
import { RiLinkedinLine } from "react-icons/ri";
import { personalInfo } from "../../data/personalInfo";
import { getProfile } from "../../lib/supabase/queries";
import { mapProfileRow } from "../../lib/supabase/transform";
import { useCmsData } from "../../lib/supabase/useCmsData";
import { assetPath } from "../../utils/assetPath";

// ─── 🔑 YOUR EMAILJS CREDENTIALS — fill these in ──────────────────────────────
const EMAILJS_SERVICE_ID  = "service_g2125im";   // e.g. "service_abc123"
const EMAILJS_TEMPLATE_ID = "template_4rmkxgu";  // e.g. "template_xyz456"
const EMAILJS_PUBLIC_KEY  = "UgmKRJkfqn_to5orc";   // e.g. "abcDEFghiJKL789"
// ──────────────────────────────────────────────────────────────────────────────

const fetchProfile = () => getProfile().then(mapProfileRow);

// personalInfo already matches mapProfileRow's output shape (name/role/email/
// location/github/linkedin/resumePath/...), so it doubles as the local fallback.
const buildContactDetails = (profile) => [
  {
    Icon: HiOutlineEnvelope,
    label: "Email",
    value: profile.email,
    link:  `mailto:${profile.email}`,
    color: "#818cf8",
    glow:  "rgba(99,102,241,0.25)",
    bg:    "rgba(99,102,241,0.1)",
  },
  {
    Icon: HiOutlineMapPin,
    label: "Location",
    value: profile.location,
    link:  null,
    color: "#f472b6",
    glow:  "rgba(244,114,182,0.2)",
    bg:    "rgba(244,114,182,0.1)",
  },
];

const buildSocialLinks = (profile) => [
  {
    Icon: BsGithub,
    label: "GitHub",
    link:  profile.github,
    color: "#e2e8f0",
    glow:  "rgba(226,232,240,0.15)",
    bg:    "rgba(255,255,255,0.06)",
  },
  {
    Icon: RiLinkedinLine,
    label: "LinkedIn",
    link:  profile.linkedin,
    color: "#60a5fa",
    glow:  "rgba(96,165,250,0.25)",
    bg:    "rgba(96,165,250,0.1)",
  },
  {
    Icon: HiOutlineEnvelope,
    label: "Email",
    link:  `mailto:${profile.email}`,
    color: "#818cf8",
    glow:  "rgba(99,102,241,0.25)",
    bg:    "rgba(99,102,241,0.1)",
  },
];

// ── Background grid ───────────────────────────────────────────────────────────
const GridBackground = () => (
  <div
    aria-hidden
    className="pointer-events-none absolute inset-0 z-0"
    style={{
      backgroundImage: `
        linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
      `,
      backgroundSize: "72px 72px",
    }}
  />
);

// ── Ambient blobs ─────────────────────────────────────────────────────────────
const AmbientGlow = () => (
  <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
    <div style={{ position:"absolute", top:"-20%", right:"-8%", width:"580px", height:"580px", borderRadius:"50%", background:"radial-gradient(circle, rgba(99,102,241,0.1) 0%, transparent 70%)", }} />
    <div style={{ position:"absolute", bottom:"5%", left:"-6%", width:"460px", height:"460px", borderRadius:"50%", background:"radial-gradient(circle, rgba(244,114,182,0.07) 0%, transparent 70%)", }} />
  </div>
);

// ── Field wrapper ─────────────────────────────────────────────────────────────
const Field = ({ label, htmlFor, children }) => (
  <div className="flex flex-col gap-1.5">
    <label
      htmlFor={htmlFor}
      className="text-xs uppercase tracking-widest font-medium"
      style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "0.1em" }}
    >
      {label}
    </label>
    {children}
  </div>
);

const baseInputStyle = {
  width:       "100%",
  background:  "rgba(255,255,255,0.04)",
  border:      "1px solid rgba(255,255,255,0.09)",
  borderRadius:"12px",
  padding:     "12px 16px",
  color:       "#f1f5f9",
  fontSize:    "0.9rem",
  fontFamily:  "var(--font-syne), sans-serif",
  outline:     "none",
  transition:  "border-color 0.25s ease, box-shadow 0.25s ease",
};

const InputField = ({ id, name, type = "text", placeholder, disabled, required }) => {
  const [focused, setFocused] = useState(false);
  return (
    <input
      type={type}
      id={id}
      name={name}
      placeholder={placeholder}
      disabled={disabled}
      required={required}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        ...baseInputStyle,
        borderColor: focused ? "rgba(99,102,241,0.55)" : "rgba(255,255,255,0.09)",
        boxShadow:   focused ? "0 0 0 3px rgba(99,102,241,0.12)" : "none",
        opacity:     disabled ? 0.6 : 1,
        cursor:      disabled ? "not-allowed" : "text",
      }}
    />
  );
};

const TextAreaField = ({ id, name, placeholder, disabled, required }) => {
  const [focused, setFocused] = useState(false);
  return (
    <textarea
      id={id}
      name={name}
      placeholder={placeholder}
      disabled={disabled}
      required={required}
      rows={5}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        ...baseInputStyle,
        resize:      "vertical",
        minHeight:   "130px",
        borderColor: focused ? "rgba(99,102,241,0.55)" : "rgba(255,255,255,0.09)",
        boxShadow:   focused ? "0 0 0 3px rgba(99,102,241,0.12)" : "none",
        opacity:     disabled ? 0.6 : 1,
        cursor:      disabled ? "not-allowed" : "text",
      }}
    />
  );
};

// ── Character counter for message ─────────────────────────────────────────────
const MessageField = ({ disabled }) => {
  const [count, setCount] = useState(0);
  const [focused, setFocused] = useState(false);
  const MAX = 1000;
  return (
    <div className="relative">
      <textarea
        id="message"
        name="message"
        placeholder="Tell me about your project or idea..."
        disabled={disabled}
        required
        maxLength={MAX}
        rows={5}
        onChange={(e) => setCount(e.target.value.length)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          ...baseInputStyle,
          resize:      "vertical",
          minHeight:   "130px",
          borderColor: focused ? "rgba(99,102,241,0.55)" : "rgba(255,255,255,0.09)",
          boxShadow:   focused ? "0 0 0 3px rgba(99,102,241,0.12)" : "none",
          opacity:     disabled ? 0.6 : 1,
          cursor:      disabled ? "not-allowed" : "text",
          paddingBottom: "28px",
        }}
      />
      <span
        className="absolute bottom-3 right-4 text-[10px] font-mono pointer-events-none"
        style={{ color: count > MAX * 0.9 ? "#f87171" : "rgba(255,255,255,0.25)" }}
      >
        {count}/{MAX}
      </span>
    </div>
  );
};

// ── Spinner ───────────────────────────────────────────────────────────────────
const Spinner = () => (
  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

// ── Main Page ─────────────────────────────────────────────────────────────────
const Contact = ({ embedded = false }) => {
  const Title = embedded ? motion.h2 : motion.h1;
  const formRef    = useRef(null);
  const [isLoading,  setIsLoading]  = useState(false);
  const [formStatus, setFormStatus] = useState(null); // null | "success" | "error"
  const [errorMsg,   setErrorMsg]   = useState("");
  const { data: profile } = useCmsData(fetchProfile, personalInfo);
  const contactDetails = buildContactDetails(profile);
  const socialLinks = buildSocialLinks(profile);

  // ── EmailJS submit ──────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setFormStatus(null);
    setErrorMsg("");

    // Basic client-side validation
    const data = new FormData(e.target);
    const name    = data.get("from_name")?.toString().trim();
    const email   = data.get("from_email")?.toString().trim();
    const subject = data.get("subject")?.toString().trim();
    const message = data.get("message")?.toString().trim();

    if (!name || !email || !subject || !message) {
      setFormStatus("error");
      setErrorMsg("Please fill in all fields before sending.");
      setIsLoading(false);
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setFormStatus("error");
      setErrorMsg("Please enter a valid email address.");
      setIsLoading(false);
      return;
    }

    try {
      // Loaded on submit only — visitors who never send a message never
      // download the EmailJS SDK.
      const { default: emailjs } = await import("@emailjs/browser");
      await emailjs.sendForm(
        EMAILJS_SERVICE_ID,
        EMAILJS_TEMPLATE_ID,
        formRef.current,
        EMAILJS_PUBLIC_KEY,
      );
      setFormStatus("success");
      formRef.current.reset();
    } catch (err) {
      console.error("EmailJS error:", err);
      setFormStatus("error");
      setErrorMsg("Something went wrong. Please try again or email me directly.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>

      <section
        id="contact"
        aria-labelledby="contact-title"
        className={`relative font-syne-scope overflow-hidden ${embedded ? "" : "min-h-screen"}`}
        style={{ background: "#080b14", color: "#f1f5f9", "--selection": "rgba(99,102,241,0.35)" }}
      >
        <GridBackground />
        <AmbientGlow />

        <div className={`relative z-10 max-w-6xl mx-auto px-6 ${embedded ? "py-20 md:py-28" : "py-28 md:py-36"}`}>

          {/* ── Page Header ── */}
          <div className="mb-16">
            <motion.p
              initial={{ opacity: 0, x: -16 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, amount: 0.15 }}
              transition={{ duration: 0.5 }}
              className="text-xs uppercase tracking-widest mb-4"
              style={{ color: "#818cf8", letterSpacing: "0.14em" }}
            >
              Get in Touch
            </motion.p>

            <Title
              id="contact-title"
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.15 }}
              transition={{ duration: 0.6, delay: 0.1, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="text-5xl md:text-7xl font-black leading-none mb-6"
              style={{ letterSpacing: "-0.03em" }}
            >
              Let&apos;s
              <br />
              <span style={{ WebkitTextStroke: "1px rgba(255,255,255,0.22)", color: "transparent" }}>
                Connect
              </span>
              <span style={{ color: "#6366f1" }}>.</span>
            </Title>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.15 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="max-w-lg text-base leading-relaxed"
              style={{ color: "rgba(255,255,255,0.6)" }}
            >
              Have a project in mind or want to discuss opportunities?
              I&apos;d love to hear from you — let&apos;s build something great together.
            </motion.p>
          </div>

          {/* ── Layout ── */}
          <div className="grid lg:grid-cols-5 gap-6">

            {/* ── Left sidebar ── */}
            <motion.aside
              initial={{ opacity: 0, x: -24 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, amount: 0.15 }}
              transition={{ duration: 0.6, delay: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="lg:col-span-2 flex flex-col gap-5"
            >
              {/* Contact info card */}
              <div
                className="rounded-2xl p-6"
                style={{
                  background:    "linear-gradient(135deg, rgba(255,255,255,0.055) 0%, rgba(255,255,255,0.018) 100%)",
                  border:        "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <p className="text-xs uppercase tracking-widest mb-5" style={{ color:"rgba(255,255,255,0.3)", letterSpacing:"0.1em" }}>
                  Contact Info
                </p>
                <div className="flex flex-col gap-5">
                  {contactDetails.map(({ Icon, label, value, link, color, bg }, i) => (
                    <div key={i} className="flex items-center gap-4">
                      <div className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center"
                           style={{ background: bg, border: `1px solid ${color}30` }}>
                        <Icon style={{ color, fontSize: "1.1rem" }} />
                      </div>
                      <div>
                        <p className="text-xs mb-0.5" style={{ color:"rgba(255,255,255,0.35)" }}>{label}</p>
                        {link ? (
                          <a href={link} className="text-sm font-medium transition-colors duration-200"
                             style={{ color:"#e2e8f0" }}
                             onMouseEnter={(e) => (e.currentTarget.style.color = color)}
                             onMouseLeave={(e) => (e.currentTarget.style.color = "#e2e8f0")}>
                            {value}
                          </a>
                        ) : (
                          <p className="text-sm font-medium" style={{ color:"#e2e8f0" }}>{value}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Social links card */}
              <div
                className="rounded-2xl p-6"
                style={{
                  background:    "linear-gradient(135deg, rgba(255,255,255,0.055) 0%, rgba(255,255,255,0.018) 100%)",
                  border:        "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <p className="text-xs uppercase tracking-widest mb-5" style={{ color:"rgba(255,255,255,0.3)", letterSpacing:"0.1em" }}>
                  Find Me On
                </p>
                <div className="flex gap-3">
                  {socialLinks.map(({ Icon, label, link, color, glow, bg }, i) => (
                    <a key={i} href={link} target="_blank" rel="noreferrer noopener" aria-label={label}
                       className="w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-250"
                       style={{ background: bg, border: `1px solid ${color}30` }}
                       onMouseEnter={(e) => {
                         e.currentTarget.style.boxShadow   = `0 0 20px ${glow}`;
                         e.currentTarget.style.borderColor = `${color}66`;
                         e.currentTarget.style.transform   = "translateY(-2px)";
                       }}
                       onMouseLeave={(e) => {
                         e.currentTarget.style.boxShadow   = "none";
                         e.currentTarget.style.borderColor = `${color}30`;
                         e.currentTarget.style.transform   = "none";
                       }}>
                      <Icon style={{ color, fontSize:"1.15rem" }} />
                    </a>
                  ))}
                </div>
              </div>

              {/* Resume download card */}
              <div
                className="rounded-2xl p-6 relative overflow-hidden"
                style={{
                  background: "linear-gradient(135deg, rgba(99,102,241,0.12) 0%, rgba(168,85,247,0.08) 100%)",
                  border:     "1px solid rgba(99,102,241,0.25)",
                }}
              >
                <div aria-hidden style={{ position:"absolute", top:0, right:0, width:"120px", height:"120px", background:"radial-gradient(circle at top right, rgba(99,102,241,0.2) 0%, transparent 70%)", pointerEvents:"none" }} />
                <p className="text-xs uppercase tracking-widest mb-2" style={{ color:"rgba(255,255,255,0.35)", letterSpacing:"0.1em" }}>Resume</p>
                <h3 className="text-base font-semibold mb-1" style={{ color:"#f1f5f9" }}>Download CV</h3>
                <p className="text-sm mb-5" style={{ color:"rgba(255,255,255,0.4)" }}>My full résumé with skills, projects, and experience.</p>
                <a
                  href={profile.resumePath?.startsWith("/") ? assetPath(profile.resumePath) : profile.resumePath}
                  download="Abhishek_MERN_Resume.pdf"
                  className="inline-flex items-center gap-2.5 px-5 py-2.5 rounded-full text-sm font-semibold transition-all duration-250"
                  style={{ background:"rgba(99,102,241,0.9)", color:"#fff" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background  = "#6366f1";
                    e.currentTarget.style.boxShadow   = "0 8px 28px rgba(99,102,241,0.5)";
                    e.currentTarget.style.transform   = "translateY(-1px)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background  = "rgba(99,102,241,0.9)";
                    e.currentTarget.style.boxShadow   = "none";
                    e.currentTarget.style.transform   = "none";
                  }}
                >
                  <HiOutlineArrowDownTray />
                  Download PDF
                </a>
              </div>
            </motion.aside>

            {/* ── Contact Form ── */}
            <motion.div
              initial={{ opacity: 0, x: 24 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, amount: 0.15 }}
              transition={{ duration: 0.6, delay: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="lg:col-span-3"
            >
              <div
                className="rounded-2xl p-7 md:p-9 h-full"
                style={{
                  background:    "linear-gradient(135deg, rgba(255,255,255,0.055) 0%, rgba(255,255,255,0.018) 100%)",
                  border:        "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <p className="text-xs uppercase tracking-widest mb-1" style={{ color:"rgba(255,255,255,0.3)", letterSpacing:"0.1em" }}>Message</p>
                <h3 className="text-xl font-bold mb-7" style={{ color:"#f1f5f9" }}>Send a Message</h3>

                {/* Status banners — inside a persistent live region so screen
                    readers announce them when they appear */}
                <div role="status" aria-live="polite">
                <AnimatePresence>
                  {formStatus === "success" && (
                    <motion.div
                      initial={{ opacity:0, y:-8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-8 }}
                      className="mb-6 px-4 py-3 rounded-xl text-sm flex items-center gap-3"
                      style={{ background:"rgba(34,197,94,0.1)", border:"1px solid rgba(34,197,94,0.25)", color:"#4ade80" }}
                    >
                      <span className="shrink-0 w-2 h-2 rounded-full" style={{ background:"#22c55e", boxShadow:"0 0 6px #22c55e" }} />
                      <span>Message sent! I&apos;ll get back to you soon. 🎉</span>
                    </motion.div>
                  )}
                  {formStatus === "error" && (
                    <motion.div
                      initial={{ opacity:0, y:-8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-8 }}
                      className="mb-6 px-4 py-3 rounded-xl text-sm flex items-center gap-3"
                      style={{ background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.25)", color:"#f87171" }}
                    >
                      <span className="shrink-0 w-2 h-2 rounded-full" style={{ background:"#ef4444", boxShadow:"0 0 6px #ef4444" }} />
                      <span>{errorMsg}</span>
                    </motion.div>
                  )}
                </AnimatePresence>
                </div>

                {/* ── The Form ── */}
                {/* 
                  EmailJS field name mapping (must match your template variables):
                    name="from_name"   → {{from_name}}
                    name="from_email"  → {{from_email}}
                    name="subject"     → {{subject}}
                    name="message"     → {{message}}
                */}
                <form
                  ref={formRef}
                  onSubmit={handleSubmit}
                  autoComplete="off"
                  noValidate
                  className="flex flex-col gap-5"
                >
                  <div className="grid md:grid-cols-2 gap-5">
                    <Field label="Name" htmlFor="from_name">
                      <InputField id="from_name" name="from_name" placeholder="Your name" disabled={isLoading} required />
                    </Field>
                    <Field label="Email" htmlFor="from_email">
                      <InputField id="from_email" name="from_email" type="email" placeholder="you@email.com" disabled={isLoading} required />
                    </Field>
                  </div>

                  <Field label="Subject" htmlFor="subject">
                    <InputField id="subject" name="subject" placeholder="What's this about?" disabled={isLoading} required />
                  </Field>

                  <Field label="Message" htmlFor="message">
                    <MessageField disabled={isLoading} />
                  </Field>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="mt-1 w-full py-4 rounded-xl text-sm font-semibold flex items-center justify-center gap-2.5 transition-all duration-300"
                    style={{
                      background: isLoading ? "rgba(99,102,241,0.5)" : "rgba(99,102,241,0.9)",
                      color:      "#fff",
                      cursor:     isLoading ? "not-allowed" : "pointer",
                      border:     "1px solid transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (!isLoading) {
                        e.currentTarget.style.background  = "#6366f1";
                        e.currentTarget.style.boxShadow   = "0 8px 32px rgba(99,102,241,0.45)";
                        e.currentTarget.style.transform   = "translateY(-1px)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background  = isLoading ? "rgba(99,102,241,0.5)" : "rgba(99,102,241,0.9)";
                      e.currentTarget.style.boxShadow   = "none";
                      e.currentTarget.style.transform   = "none";
                    }}
                  >
                    {isLoading ? (
                      <><Spinner /> Sending…</>
                    ) : (
                      <>Send Message <BsArrowRight /></>
                    )}
                  </button>
                </form>
              </div>
            </motion.div>
          </div>
        </div>
      </section>
    </>
  );
};

export default Contact;