import logo from "./theckards-logo.png";

/** The supplied symbol and wordmark, shared by every header and the public footer. */
export function Brand({ href = "/", admin = false }: { href?: string; admin?: boolean }) {
  return <a className={admin ? "brand brand-admin" : "brand"} href={href}>
    <img className="brand-logo" src={logo.src} width={logo.width} height={logo.height} alt="Theckards" />
    {admin && <span className="brand-context">Admin</span>}
  </a>;
}
