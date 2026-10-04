"use client";

export const Card = ({ children, className = "" }) => (
  <div
    className={`rounded-2xl p-5 ${className}`}
    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
  >
    {children}
  </div>
);

export const Field = ({ label, children }) => (
  <label className="flex flex-col gap-1.5 text-sm">
    <span className="text-xs uppercase tracking-widest text-white/40">{label}</span>
    {children}
  </label>
);

const inputStyle = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "10px",
  padding: "9px 12px",
  color: "#f1f5f9",
  fontSize: "0.875rem",
  width: "100%",
};

export const Input = (props) => <input {...props} style={{ ...inputStyle, ...props.style }} />;
export const TextArea = (props) => (
  <textarea {...props} rows={props.rows || 3} style={{ ...inputStyle, resize: "vertical", ...props.style }} />
);
export const Select = ({ children, ...props }) => (
  <select {...props} style={{ ...inputStyle, ...props.style }}>
    {children}
  </select>
);

export const Checkbox = ({ label, ...props }) => (
  <label className="flex items-center gap-2 text-sm text-white/70">
    <input type="checkbox" {...props} />
    {label}
  </label>
);

export const Button = ({ children, variant = "primary", ...props }) => {
  const styles = {
    primary: { background: "rgba(99,102,241,0.9)", color: "#fff" },
    ghost: { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.75)" },
    danger: { background: "rgba(239,68,68,0.15)", color: "#f87171", border: "1px solid rgba(239,68,68,0.3)" },
  };
  return (
    <button
      {...props}
      className={`px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 ${props.className || ""}`}
      style={{ ...styles[variant], ...props.style }}
    >
      {children}
    </button>
  );
};

export const Banner = ({ type = "error", children }) =>
  children ? (
    <div
      role={type === "error" ? "alert" : "status"}
      className="px-4 py-3 rounded-xl text-sm mb-4"
      style={
        type === "error"
          ? { background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171" }
          : { background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.25)", color: "#4ade80" }
      }
    >
      {children}
    </div>
  ) : null;

export const EmptyState = ({ children }) => (
  <p className="text-sm text-white/30 text-center py-10">{children}</p>
);
