"use client";

import { useCallback, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { SERVICES } from "@/lib/services";
import { dashboardPathFor, useSession } from "@/lib/use-session";
import { AuthModal } from "./components/auth-modal";
import type { AuthMode, AuthRole } from "./components/auth-panel";
import { BrandLogo } from "./components/brand-logo";

const NAV_LINKS = [
  { href: "#home", label: "Home" },
  { href: "#about", label: "About" },
  { href: "#services", label: "Services" },
  { href: "#contact", label: "Contact" },
];

const SERVICE_EXTRAS: Record<string, { icon: string; perks: string[] }> = {
  essential: { icon: "🧽", perks: ["Dusting & vacuuming", "Kitchen wipe-down", "Bathroom refresh"] },
  deep: { icon: "🫧", perks: ["Inside appliances", "Grout & tiles", "Behind furniture"] },
  "move-out": { icon: "📦", perks: ["Empty-room detail", "Cupboards inside & out", "Deposit-ready finish"] },
};

const AREAS = [
  { name: "Sukhumvit", note: "Asok · Phrom Phong · Thong Lo · On Nut", phone: "+66 2 123 4501" },
  { name: "Head Office — Silom", note: "88 Silom Rd, Suriyawong, Bang Rak, Bangkok 10500", phone: "+66 2 123 4500" },
  { name: "Ari & Phaya Thai", note: "Ari · Saphan Khwai · Victory Monument", phone: "+66 2 123 4502" },
];

function displayPrice(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function Wave({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 1440 120" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 64c180 40 360 56 540 40s360-72 540-72 270 32 360 48v40H0Z" />
    </svg>
  );
}

export default function HomePage() {
  const session = useSession();
  const [auth, setAuth] = useState<{ open: boolean; role?: AuthRole; mode?: AuthMode }>({
    open: false,
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [contactSent, setContactSent] = useState(false);

  const openAuth = useCallback((role?: AuthRole, mode?: AuthMode) => {
    setMenuOpen(false);
    setAuth({ open: true, role, mode });
  }, []);
  const closeAuth = useCallback(() => setAuth((prev) => ({ ...prev, open: false })), []);

  const signedIn = session.status === "ready" ? session.user : null;

  function bookNow() {
    if (signedIn) {
      window.location.href = dashboardPathFor(signedIn.role);
    } else {
      openAuth("customer", "sign-up");
    }
  }

  function handleContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.currentTarget.reset();
    setContactSent(true);
  }

  return (
    <main className="home">
      <header className="site-header is-sticky">
        <div className="site-header-inner">
          <BrandLogo />
          <button
            type="button"
            className="site-menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="site-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="sr-only">Menu</span>
            <span aria-hidden="true">{menuOpen ? "✕" : "☰"}</span>
          </button>
          <nav id="site-nav" className={`site-nav${menuOpen ? " is-open" : ""}`} aria-label="Main">
            {NAV_LINKS.map((link) => (
              <a key={link.href} className="site-link" href={link.href} onClick={() => setMenuOpen(false)}>
                {link.label}
              </a>
            ))}
            <span className="site-location">
              <span aria-hidden="true">📍</span> Bangkok
            </span>
            {signedIn ? (
              <Link className="sunny-button small" href={dashboardPathFor(signedIn.role)}>
                My dashboard
              </Link>
            ) : (
              <button type="button" className="sunny-button small" onClick={() => openAuth()}>
                Login
              </button>
            )}
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section id="home" className="hero">
        <div className="hero-inner">
          <div className="hero-copy">
            <p className="eyebrow-light">Bangkok&apos;s friendly home cleaners</p>
            <h1>
              Sparkling homes,
              <br />
              <span>zero stress.</span>
            </h1>
            <p className="hero-lead">
              Pick a day, pick a time, and a vetted Sai Ping cleaner takes care of
              the rest. Rate every visit so great service keeps getting better.
            </p>
            <div className="hero-actions">
              <button type="button" className="sunny-button" onClick={bookNow}>
                {signedIn ? "Go to my dashboard →" : "Book a cleaning →"}
              </button>
              {signedIn ? null : (
                <button type="button" className="ghost-button" onClick={() => openAuth("cleaner", "sign-up")}>
                  Become a cleaner
                </button>
              )}
            </div>
            <ul className="hero-points">
              <li>✓ Vetted cleaners</li>
              <li>✓ 9 AM &amp; 2 PM arrival windows</li>
              <li>✓ Rate &amp; review every visit</li>
            </ul>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="hero-bubble">
              <Image src="/brand/sai-ping-mascot.png" alt="" width={320} height={320} priority />
            </div>
            <span className="sparkle s1">✦</span>
            <span className="sparkle s2">✦</span>
            <span className="sparkle s3">✦</span>
            <div className="hero-badge">
              <strong>60 sec</strong>
              <span>to book a cleaning</span>
            </div>
          </div>
        </div>
        <Wave className="hero-wave" />
      </section>

      {/* About */}
      <section id="about" className="home-section">
        <div className="section-inner about-grid">
          <div className="about-card" aria-hidden="true">
            <Image src="/brand/sai-ping-mascot.png" alt="" width={220} height={220} />
            <p>“Sai Ping” — the little cleaning buddy who makes your home shine.</p>
          </div>
          <div>
            <p className="eyebrow">About Sai Ping</p>
            <h2 className="section-title">A cleaner home, a calmer you.</h2>
            <p className="section-text">
              Sai Ping started in Bangkok with one simple idea: booking a cleaner
              should be as easy as ordering a coffee. We match you with friendly,
              background-checked cleaners who choose the days they work, so every
              booking you make is one a real person can take.
            </p>
            <p className="section-text">
              After each visit you rate your cleaner and leave a review. Those
              reviews keep standards high and help great cleaners grow.
            </p>
            <div className="stat-row">
              <div>
                <strong>3</strong>
                <span>cleaning packages</span>
              </div>
              <div>
                <strong>2</strong>
                <span>arrival windows a day</span>
              </div>
              <div>
                <strong>1–5★</strong>
                <span>reviews after every visit</span>
              </div>
              <div>
                <strong>7</strong>
                <span>days a week</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Services */}
      <section id="services" className="home-section tinted">
        <div className="section-inner">
          <div className="section-head">
            <div>
              <p className="eyebrow">Services we offer</p>
              <h2 className="section-title">Our best cleaning packages</h2>
            </div>
            <p className="section-text">
              Every package includes eco-friendly supplies and a cleaner who
              arrives in your chosen window.
            </p>
          </div>
          <div className="service-grid">
            {SERVICES.map((service) => {
              const extra = SERVICE_EXTRAS[service.id];
              return (
                <article key={service.id} className="service-tile">
                  <span className="service-tile-icon" aria-hidden="true">
                    {extra?.icon ?? "✨"}
                  </span>
                  <h3>{service.name}</h3>
                  <p>{service.description}</p>
                  <ul>
                    {extra?.perks.map((perk) => (
                      <li key={perk}>{perk}</li>
                    ))}
                  </ul>
                  <div className="service-tile-foot">
                    <span>
                      <strong>{displayPrice(service.priceCents)}</strong> · {service.duration}
                    </span>
                    <button type="button" className="text-button" onClick={bookNow}>
                      Book →
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="steps">
            {[
              ["1", "Pick an available day", "Only days with a cleaner on shift can be booked."],
              ["2", "A cleaner accepts", "A Sai Ping cleaner claims your job and shows up on time."],
              ["3", "Rate & review", "Tell us how it went — your review helps everyone."],
            ].map(([num, title, text]) => (
              <div key={num} className="step">
                <span className="step-num">{num}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="home-section">
        <div className="section-inner contact-grid">
          <div>
            <p className="eyebrow">Contact us</p>
            <h2 className="section-title">Get connected with us</h2>
            <p className="section-text">
              Questions about a booking, or want to join our team? We&apos;re
              based in Bangkok and happy to help.
            </p>
            <ul className="contact-list">
              <li>
                <span aria-hidden="true">📍</span> 88 Silom Rd, Bang Rak, Bangkok 10500, Thailand
              </li>
              <li>
                <span aria-hidden="true">📞</span> +66 2 123 4500
              </li>
              <li>
                <span aria-hidden="true">✉️</span> hello@saiping.co.th
              </li>
              <li>
                <span aria-hidden="true">🕘</span> Mon–Fri 8:00–18:00 · Sat–Sun 9:00–16:00
              </li>
            </ul>
          </div>
          <form className="contact-card" onSubmit={handleContact}>
            <h3>Send us a message</h3>
            <label className="auth-field">
              <span className="field-label">Your name</span>
              <input className="text-input" name="name" required onChange={() => setContactSent(false)} />
            </label>
            <label className="auth-field">
              <span className="field-label">Email</span>
              <input className="text-input" name="email" type="email" required />
            </label>
            <label className="auth-field">
              <span className="field-label">Message</span>
              <textarea className="text-input contact-textarea" name="message" rows={4} required />
            </label>
            <button type="submit" className="sunny-button">
              Send message
            </button>
            {contactSent ? (
              <p className="contact-sent" role="status">
                Thanks! We&apos;ll get back to you within one working day.
              </p>
            ) : null}
          </form>
        </div>

        <div className="section-inner">
          <h2 className="section-title centered">Find us in your area</h2>
          <div className="area-grid">
            {AREAS.map((area) => (
              <div key={area.name} className="area-card">
                <h3>{area.name}</h3>
                <p>{area.note}</p>
                <p className="area-phone">{area.phone}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <div className="section-inner footer-inner">
          <div>
            <BrandLogo height={40} />
            <p>Sparkling homes, zero stress — across Bangkok.</p>
          </div>
          <nav className="footer-links" aria-label="Footer">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
            {signedIn ? null : (
              <button type="button" className="text-button" onClick={() => openAuth()}>
                Login
              </button>
            )}
          </nav>
        </div>
        <p className="footer-copy">© 2026 Sai Ping Cleaning Co., Bangkok.</p>
      </footer>

      <AuthModal open={auth.open} initialRole={auth.role} initialMode={auth.mode} onClose={closeAuth} />
    </main>
  );
}
