"use client";
import {
  BookOpen,
  Code2,
  FileCheck2,
  LayoutDashboard,
  Menu,
  Moon,
  Scale,
  Settings2,
  Sun,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { WalletStatus } from "./wallet-status";

const links = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/program-studio", label: "Program Studio", icon: Code2 },
  { href: "/claims", label: "Claims", icon: FileCheck2 },
  { href: "/disputes", label: "Disputes", icon: Scale },
  { href: "/account-ledger", label: "Account Ledger", icon: WalletCards },
  { href: "/documentation", label: "Documentation", icon: BookOpen },
  { href: "/settings", label: "Settings", icon: Settings2 },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const drawerWasOpen = useRef(false);
  useEffect(() => {
    const saved = window.localStorage.getItem("bisect-theme");
    const selected = saved === "dark" ? "dark" : "light";
    setTheme(selected);
    document.documentElement.dataset["theme"] = selected;
  }, []);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && menuOpen) {
        setMenuOpen(false);
      }
      if (event.key === "Tab" && menuOpen) {
        const focusable = document.querySelectorAll<HTMLElement>(
          ".sidebar.open a, .sidebar.open button",
        );
        const first = focusable.item(0);
        const last = focusable.item(focusable.length - 1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);
  useEffect(() => {
    if (menuOpen) {
      drawerWasOpen.current = true;
      document.querySelector<HTMLElement>(".sidebar nav a")?.focus();
    } else if (drawerWasOpen.current) {
      drawerWasOpen.current = false;
      menuTrigger.current?.focus();
    }
  }, [menuOpen]);
  function toggleTheme() {
    const selected = theme === "light" ? "dark" : "light";
    setTheme(selected);
    document.documentElement.dataset["theme"] = selected;
    window.localStorage.setItem("bisect-theme", selected);
  }
  if (pathname === "/") {
    return (
      <div className="marketing-shell">
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <header className="marketing-header">
          <Link href="/" className="brand">
            <span className="mark">B</span> BISECT
          </Link>
          <nav className="marketing-nav" aria-label="Product navigation">
            <Link href="/dashboard">Dashboard</Link>
            <Link className="marketing-studio-link" href="/program-studio">
              Program Studio
            </Link>
            <Link href="/documentation">Docs</Link>
          </nav>
          <button
            type="button"
            className="button icon-button"
            onClick={toggleTheme}
            aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
          >
            {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
          </button>
        </header>
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
        <footer className="marketing-footer">
          <span>BISECT · optimistic computation verification</span>
          <span>Base Sepolia testnet prototype · unaudited research software</span>
        </footer>
      </div>
    );
  }
  return (
    <div className="frame">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {menuOpen ? (
        <button
          type="button"
          className="scrim"
          aria-label="Close navigation"
          onClick={() => {
            setMenuOpen(false);
          }}
        />
      ) : null}
      <aside className={"sidebar" + (menuOpen ? " open" : "")} aria-label="Main navigation">
        <Link href="/" className="brand" onClick={() => setMenuOpen(false)}>
          <span className="mark">B</span> BISECT
        </Link>
        <div>
          <p className="nav-label">Workspace</p>
          <nav className="nav" aria-label="Main navigation">
            {links.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={
                  pathname === href ||
                  (href !== "/dashboard" && href !== "/" && pathname.startsWith(`${href}/`))
                    ? "page"
                    : undefined
                }
                onClick={() => setMenuOpen(false)}
              >
                <Icon size={17} aria-hidden="true" />
                {label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="sidebar-foot">
          <span className="chip warn">
            <span className="dot" />
            Testnet preview
          </span>
          <p style={{ marginTop: 10 }}>
            Read-only explorer · data depends on an available indexer.
          </p>
        </div>
      </aside>
      <div className="workspace" inert={menuOpen}>
        <header className="top">
          <div className="top-right">
            <button
              ref={menuTrigger}
              type="button"
              className="button icon-button menu-button"
              aria-label="Open navigation"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            >
              <Menu size={17} />
            </button>
            <span className="eyebrow">Base Sepolia · testnet target</span>
          </div>
          <div className="top-right">
            <WalletStatus />
            <button
              type="button"
              className="button icon-button"
              onClick={toggleTheme}
              aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
            >
              {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
            </button>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
        <footer className="footer">
          <span>BISECT · deterministic computation verification</span>
          <span>Unaudited research software</span>
        </footer>
      </div>
    </div>
  );
}
