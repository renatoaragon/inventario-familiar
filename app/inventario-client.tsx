"use client";

import { Fragment, useCallback, useEffect, useState } from "react";

// ── Types (mirror the APIs) ─────────────────────────────────────────
type Session =
  | { kind: "admin"; viaMember?: boolean; pixKey: string | null }
  | { kind: "member"; name: string; role: string; pixKey: string | null }
  | null;

type Doc = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  uploadedByName: string;
  createdAt: string;
};

type Member = {
  id: string;
  name: string;
  phone: string;
  role: string;
  active: boolean;
  hasPassword: boolean;
  blocked: boolean;
  pixKey: string | null;
  createdAt: string;
};

type Extrato = {
  member: { id: string; name: string; role: string };
  creditos: {
    id: string;
    receitaId: string;
    descricao: string;
    receitaGrossCents: number;
    kind: string;
    amountCents: number;
    receivedAt: string;
  }[];
  repasses: {
    id: string;
    amountCents: number;
    paidAt: string;
    nota: string | null;
    receitaDescricao: string | null;
  }[];
  totalCreditosCents: number;
  totalRecebidoCents: number;
  saldoCents: number;
};

type Summary = {
  months: {
    month: string;
    grossCents: number;
    feeCents: number;
    despesasCents: number;
    paidCents: number;
  }[];
  totals: { grossCents: number; feeCents: number; despesasCents: number; paidCents: number };
  perMember: {
    id: string;
    name: string;
    role: string;
    active: boolean;
    creditCents: number;
    paidCents: number;
    saldoCents: number;
  }[];
};

type Receita = {
  id: string;
  descricao: string;
  grossCents: number;
  receivedAt: string;
  shares: {
    id: string;
    memberId: string;
    memberName: string;
    memberPix: string | null;
    kind: string;
    amountCents: number;
  }[];
  repasses: { id: string; memberId: string; amountCents: number }[];
  despesas: { id: string; descricao: string; amountCents: number }[];
};

type Despesa = {
  id: string;
  descricao: string;
  amountCents: number;
  dueAt: string;
  receitaId: string | null;
  receitaDescricao: string | null;
};

type Repasse = {
  id: string;
  memberId: string;
  memberName: string;
  receitaDescricao: string | null;
  amountCents: number;
  paidAt: string;
  nota: string | null;
};

type LogRow = {
  id: string;
  actor: string;
  action: string;
  detail: string | null;
  ip: string | null;
  createdAt: string;
};

// ── Helpers ─────────────────────────────────────────────────────────
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const fmtBRL = (cents: number) => BRL.format(cents / 100);
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const fmtMonth = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
};

/** "4.000,00" | "4000" | "1311.24" | "4.000" → cents (comma OR dot as decimal separator) */
function parseBRL(v: string): number {
  let clean = v.trim().replace(/[R$\s]/g, "");
  if (clean.includes(",")) {
    // BR format: dots are thousands separators, comma is the decimal
    clean = clean.replace(/\./g, "").replace(",", ".");
  } else {
    const parts = clean.split(".");
    const last = parts[parts.length - 1];
    if (parts.length > 1 && last.length <= 2) {
      // dot as decimal: "1311.24"
      clean = parts.slice(0, -1).join("") + "." + last;
    } else {
      // dots as thousands: "4.000" / no dot
      clean = parts.join("");
    }
  }
  const n = parseFloat(clean);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(mime: string): string {
  if (mime.startsWith("image/")) return "🖼️";
  if (mime.includes("pdf")) return "📄";
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime.includes("csv")) return "📊";
  if (mime.includes("word") || mime.includes("document")) return "📝";
  if (mime.includes("zip") || mime.includes("compressed")) return "🗜️";
  return "📎";
}

const ROLE_LABEL: Record<string, string> = { HEIR: "Herdeiro(a)", LAWYER: "Advogado" };

// Chart colors validated for contrast: #4F46E5 entradas · #B45309 honorários
// · #BE123C despesas (1 series per chart; contrast vs white ≥ 3:1).
const CHART_ENTRADAS = "#4F46E5";
const CHART_HONORARIOS = "#B45309";
const CHART_DESPESAS = "#BE123C";

async function jfetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(data.message ?? `Erro ${res.status}`);
  return data;
}

// ── Root component ──────────────────────────────────────────────────
export function InventarioClient({ session }: { session: Session }) {
  return (
    <div className="min-h-screen bg-[#FCFCFB] text-slate-900 antialiased">
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(15,23,42,.9) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,.9) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, #000 20%, transparent 75%)",
        }}
      />
      {session ? <Portal session={session} /> : <Login />}
    </div>
  );
}

// ── Login (phone → code/password) ───────────────────────────────────
function Login() {
  const [step, setStep] = useState<"phone" | "code" | "password" | "setpass">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function start() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await jfetch<{ mode: string; message: string }>("/api/inventario/auth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      if (r.mode === "unauthorized" || r.mode === "blocked") {
        setErr(r.message);
      } else if (r.mode === "password") {
        setStep("password");
        setMsg(null);
      } else {
        setStep("code");
        setMsg(r.message);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao iniciar o acesso.");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await jfetch<{ needPassword: boolean }>("/api/inventario/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code }),
      });
      if (r.needPassword) {
        setStep("setpass");
        setMsg("Código confirmado! Agora crie a sua senha de acesso.");
        setBusy(false);
      } else {
        window.location.reload();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Código inválido.");
      setBusy(false);
    }
  }

  async function loginPassword() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await jfetch("/api/inventario/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password }),
      });
      window.location.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Senha incorreta.");
      setBusy(false);
    }
  }

  async function setNewPassword() {
    if (busy) return;
    if (password.length < 8) {
      setErr("A senha deve ter pelo menos 8 caracteres.");
      return;
    }
    if (password !== password2) {
      setErr("As senhas não coincidem.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await jfetch("/api/inventario/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      window.location.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao definir a senha.");
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-7 shadow-[0_2px_8px_rgba(15,23,42,.05),0_16px_48px_-16px_rgba(15,23,42,.12)]">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-700">
          Portal da família
        </div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
          Inventário Familiar
        </h1>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          Acesso restrito aos herdeiros e ao advogado do inventário. Entre com o seu
          número de WhatsApp para receber o código.
        </p>

        {step === "phone" && (
          <form
            className="mt-6 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void start();
            }}
          >
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Seu WhatsApp (com DDD; fora do Brasil, com DDI)
            </label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(11) 98765-4321"
              inputMode="tel"
              autoFocus
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
            <button
              type="submit"
              disabled={busy || phone.replace(/\D/g, "").length < 10}
              className="w-full rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Verificando…" : "Continuar"}
            </button>
          </form>
        )}

        {step === "code" && (
          <form
            className="mt-6 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void verify();
            }}
          >
            {msg && (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                {msg}
              </p>
            )}
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Código de 6 dígitos
            </label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="••••••"
              inputMode="numeric"
              autoFocus
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-center text-xl font-bold tracking-[0.5em] outline-none transition placeholder:text-slate-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
            <button
              type="submit"
              disabled={busy || code.length !== 6}
              className="w-full rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Verificando…" : "Confirmar código"}
            </button>
            <div className="flex justify-between text-[11px] text-slate-500">
              <button type="button" onClick={() => setStep("phone")} className="hover:text-slate-800">
                ← Trocar número
              </button>
              <button type="button" onClick={() => void start()} className="hover:text-slate-800">
                Reenviar código
              </button>
            </div>
          </form>
        )}

        {step === "password" && (
          <form
            className="mt-6 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void loginPassword();
            }}
          >
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Sua senha
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoFocus
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition placeholder:text-slate-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
            <button
              type="submit"
              disabled={busy || password.length === 0}
              className="w-full rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Entrando…" : "Entrar"}
            </button>
            <div className="flex justify-between text-[11px] text-slate-500">
              <button type="button" onClick={() => setStep("phone")} className="hover:text-slate-800">
                ← Trocar número
              </button>
              <span className="text-right text-slate-400">
                Esqueceu a senha? Peça o reset diretamente ao administrador.
              </span>
            </div>
          </form>
        )}

        {step === "setpass" && (
          <form
            className="mt-6 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void setNewPassword();
            }}
          >
            {msg && (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                {msg}
              </p>
            )}
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Crie sua senha (mín. 8 caracteres)
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Nova senha"
              autoFocus
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition placeholder:text-slate-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
            <input
              type="password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              placeholder="Repita a senha"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition placeholder:text-slate-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
            <button
              type="submit"
              disabled={busy || password.length < 8 || password !== password2}
              className="w-full rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Salvando…" : "Criar senha e entrar"}
            </button>
            <p className="text-[11px] text-slate-400">
              A partir de agora, você entra com o número de telefone e esta senha.
            </p>
          </form>
        )}
        {err && (
          <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{err}</p>
        )}
      </div>
    </div>
  );
}

// ── Portal ──────────────────────────────────────────────────────────
type AdminTab = "painel" | "extrato" | "lancamentos" | "documentos" | "membros" | "acessos";
type MemberTab = "documentos" | "extrato";

function Portal({ session }: { session: NonNullable<Session> }) {
  const isAdmin = session.kind === "admin";
  const [adminTab, setAdminTab] = useState<AdminTab>("painel");
  const [memberTab, setMemberTab] = useState<MemberTab>("extrato");
  const [viewAs, setViewAs] = useState<Member | null>(null); // admin "view as"
  const [members, setMembers] = useState<Member[]>([]);
  // The admin is also an heir: member rules (e.g. PIX) apply to them too.
  const [pix, setPix] = useState(session.pixKey);
  const [pixOpen, setPixOpen] = useState(false);

  const loadMembers = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const r = await jfetch<{ members: Member[] }>("/api/inventario/admin/members");
      setMembers(r.members);
    } catch {
      /* ignore */
    }
  }, [isAdmin]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  async function logout() {
    await fetch("/api/inventario/auth/logout", { method: "POST" });
    window.location.reload();
  }

  const memberView = !isAdmin || viewAs !== null;

  return (
    <div className="relative mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      {/* Header */}
      <header className="mb-6 flex flex-wrap items-center gap-3 border-b border-slate-200 pb-5">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-700">
            Portal da família
          </div>
          <h1
            className="text-xl font-bold tracking-tight sm:text-2xl"
            style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
          >
            Inventário Familiar
          </h1>
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <InstallHelp />
          {isAdmin ? (
            <>
              <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 font-semibold text-indigo-700">
                Administrador
              </span>
              {session.kind === "admin" && session.viaMember ? (
                <button onClick={logout} className="text-slate-500 hover:text-slate-800">
                  Sair
                </button>
              ) : (
                <a href="/dashboard" className="text-slate-500 hover:text-slate-800">
                  ← Dashboard
                </a>
              )}
            </>
          ) : (
            <>
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-700">
                {session.kind === "member" ? session.name : ""}
                <span className="ml-1.5 font-normal text-slate-400">
                  {session.kind === "member" ? ROLE_LABEL[session.role] ?? session.role : ""}
                </span>
              </span>
              <button onClick={logout} className="text-slate-500 hover:text-slate-800">
                Sair
              </button>
            </>
          )}
        </div>
      </header>

      {/* "View as" bar (admin) */}
      {isAdmin && (
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs">
          <span className="font-semibold text-slate-600">👁 Ver como:</span>
          <select
            value={viewAs?.id ?? ""}
            onChange={(e) => {
              const m = members.find((x) => x.id === e.target.value) ?? null;
              setViewAs(m);
            }}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 outline-none focus:border-indigo-400"
          >
            <option value="">Visão de administrador</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({ROLE_LABEL[m.role] ?? m.role})
              </option>
            ))}
          </select>
          {viewAs && (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 font-semibold text-amber-800">
              A ver o portal como {viewAs.name}; os acessos ficam registrados
            </span>
          )}
        </div>
      )}

      {/* Own PIX key (members and admin): pending warning or card showing the key */}
      {!viewAs &&
        (!pix ? (
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
            <span className="text-xs leading-relaxed text-amber-900">
              <b>⚠ Chave PIX pendente.</b> Cadastre a sua chave para receber os repasses.
            </span>
            <button
              onClick={() => setPixOpen(true)}
              className="ml-auto rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-amber-700"
            >
              🔑 Cadastrar chave PIX
            </button>
          </div>
        ) : (
          <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs">
            <span className="font-semibold text-slate-600">🔑 Minha chave PIX:</span>
            <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono text-[11px] text-emerald-800">
              {pix}
            </span>
            <button
              onClick={() => setPixOpen(true)}
              className="ml-auto text-slate-500 hover:text-slate-800"
            >
              Alterar
            </button>
          </div>
        ))}
      {pixOpen && (
        <PixModal
          current={pix}
          onClose={() => setPixOpen(false)}
          onSaved={(k) => {
            setPix(k);
            setPixOpen(false);
          }}
        />
      )}

      {/* Navigation */}
      <nav className="mb-6 flex flex-wrap gap-1.5 text-xs font-semibold">
        {memberView ? (
          (["extrato", "documentos"] as MemberTab[]).map((t) => (
            <TabButton key={t} active={memberTab === t} onClick={() => setMemberTab(t)}>
              {t === "extrato" ? "💰 Meu extrato" : "📁 Documentos"}
            </TabButton>
          ))
        ) : (
          (
            [
              ["painel", "📈 Painel"],
              ["extrato", "💰 Meu extrato"],
              ["lancamentos", "🧾 Lançamentos"],
              ["documentos", "📁 Documentos"],
              ["membros", "👥 Membros"],
              ["acessos", "🔎 Acessos"],
            ] as [AdminTab, string][]
          ).map(([t, label]) => (
            <TabButton key={t} active={adminTab === t} onClick={() => setAdminTab(t)}>
              {label}
            </TabButton>
          ))
        )}
      </nav>

      {/* Content */}
      {memberView ? (
        memberTab === "extrato" ? (
          <ExtratoView viewAsId={viewAs?.id} />
        ) : (
          <DocumentsView isAdmin={isAdmin && !viewAs} />
        )
      ) : adminTab === "painel" ? (
        <PainelView />
      ) : adminTab === "extrato" ? (
        <ExtratoView />
      ) : adminTab === "lancamentos" ? (
        <LancamentosView members={members} />
      ) : adminTab === "documentos" ? (
        <DocumentsView isAdmin />
      ) : adminTab === "membros" ? (
        <MembrosView members={members} reload={loadMembers} />
      ) : (
        <AcessosView />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border px-3 py-2 transition ${
        active
          ? "border-slate-900 bg-slate-900 text-white shadow-sm"
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900"
      }`}
    >
      {children}
    </button>
  );
}

// ── Tiles and chart ─────────────────────────────────────────────────
function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-bold tracking-tight text-slate-900">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-400">{hint}</div>}
    </div>
  );
}

/** Monthly bar chart (1 series): thin bars, rounded top, per-bar tooltip. */
function MonthBars({
  data,
  color,
  title,
}: {
  data: { month: string; cents: number }[];
  color: string;
  title: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.cents), 1);
  const H = 140;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-slate-700">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
        {title}
      </div>
      {data.length === 0 ? (
        <p className="py-10 text-center text-xs italic text-slate-400">Sem lançamentos ainda.</p>
      ) : (
        <div className="relative">
          {/* subdued background grid */}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex h-[140px] flex-col justify-between">
            {[max, max / 2, 0].map((v, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-14 text-right text-[9px] tabular-nums text-slate-400">
                  {fmtBRL(Math.round(v)).replace(",00", "")}
                </span>
                <div className="h-px flex-1 bg-slate-100" />
              </div>
            ))}
          </div>
          <div className="ml-16 flex items-end gap-[6px]" style={{ height: H }}>
            {data.map((d, i) => (
              <div
                key={d.month}
                className="group relative flex h-full max-w-[48px] flex-1 items-end"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                <div
                  className="w-full rounded-t-[4px] transition-opacity"
                  style={{
                    height: `${Math.max((d.cents / max) * 100, 2)}%`,
                    background: color,
                    opacity: hover === null || hover === i ? 1 : 0.45,
                  }}
                />
                {hover === i && (
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] shadow-lg">
                    <span className="font-semibold text-slate-800">{fmtMonth(d.month)}</span>
                    <span className="mx-1.5 text-slate-300">·</span>
                    <span className="tabular-nums text-slate-700">{fmtBRL(d.cents)}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="ml-16 mt-1.5 flex gap-[6px]">
            {data.map((d) => (
              <div key={d.month} className="max-w-[48px] flex-1 text-center text-[9px] text-slate-500">
                {fmtMonth(d.month)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Dashboard (admin) ───────────────────────────────────────────────
function PainelView() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showBalanco, setShowBalanco] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    jfetch<{ summary: Summary }>("/api/inventario/admin/summary")
      .then((r) => setSummary(r.summary))
      .catch((e) => setErr(e instanceof Error ? e.message : "Erro"));
  }, []);

  if (err) return <ErrorBox msg={err} />;
  if (!summary) return <Loading />;

  const aRepassar = summary.perMember.reduce((a, m) => a + m.saldoCents, 0);

  // ── Monthly balance for the WhatsApp group ────────────────────────
  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const monthLabel = (d: Date) => d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const now = new Date();
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const zeroMonth = { grossCents: 0, feeCents: 0, despesasCents: 0, paidCents: 0 };
  const balMeses = [
    { label: monthLabel(prevDate), tag: "mês anterior", ...(summary.months.find((m) => m.month === monthKey(prevDate)) ?? zeroMonth) },
    { label: monthLabel(now), tag: "mês atual", ...(summary.months.find((m) => m.month === monthKey(now)) ?? zeroMonth) },
  ];

  function balancoTexto(): string {
    const L: string[] = [
      "🌟 *INVENTÁRIO FAMILIAR*",
      `*Balanço financeiro* · ${now.toLocaleDateString("pt-BR")}`,
      "",
      `💼 *Saldo total a repassar:* ${fmtBRL(aRepassar)}`,
      "",
    ];
    for (const m of balMeses) {
      L.push(`📅 *${m.label}* (${m.tag})`);
      L.push(`↗ Entradas: ${fmtBRL(m.grossCents)}`);
      L.push(`⚖ Honorários (5%): ${fmtBRL(m.feeCents)}`);
      L.push(`↘ Despesas: ${fmtBRL(m.despesasCents)}`);
      L.push(`💸 Repasses feitos: ${fmtBRL(m.paidCents)}`);
      L.push("");
    }
    L.push(`✅ Total já repassado: ${fmtBRL(summary!.totals.paidCents)}`);
    L.push("");
    L.push("_Balanço gerado no portal da família_");
    return L.join("\n");
  }

  async function copiarBalanco() {
    await navigator.clipboard.writeText(balancoTexto());
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <button
          onClick={() => setShowBalanco(true)}
          className="rounded-lg border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100"
        >
          📲 Balanço para WhatsApp
        </button>
      </div>

      {showBalanco && (
        <>
          <div
            className="fixed inset-0 z-30 bg-slate-900/30 backdrop-blur-sm"
            onClick={() => setShowBalanco(false)}
          />
          <div className="fixed left-1/2 top-1/2 z-40 max-h-[92vh] w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
            {/* Balance card (screenshot friendly) */}
            <div className="rounded-t-2xl bg-gradient-to-b from-slate-900 to-slate-800 px-5 py-4 text-white">
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-400">
                Inventário Familiar
              </div>
              <div className="flex items-baseline gap-2">
                <h3 className="text-lg font-bold" style={{ fontFamily: "Georgia, serif" }}>
                  Balanço financeiro
                </h3>
                <span className="text-[11px] text-slate-300">{now.toLocaleDateString("pt-BR")}</span>
              </div>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center">
                <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-amber-700">
                  Saldo total a repassar
                </div>
                <div className="text-2xl font-bold tabular-nums text-slate-900">{fmtBRL(aRepassar)}</div>
              </div>
              {balMeses.map((m) => (
                <div key={m.label} className="rounded-xl border border-slate-200 p-3.5">
                  <p className="mb-2 text-xs font-bold capitalize text-slate-800">
                    📅 {m.label} <span className="font-normal text-slate-400">({m.tag})</span>
                  </p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                    <span className="text-slate-500">↗ Entradas</span>
                    <span className="text-right font-semibold tabular-nums">{fmtBRL(m.grossCents)}</span>
                    <span className="text-slate-500">⚖ Honorários (5%)</span>
                    <span className="text-right tabular-nums text-amber-800">{fmtBRL(m.feeCents)}</span>
                    <span className="text-slate-500">↘ Despesas</span>
                    <span className="text-right tabular-nums text-rose-700">{fmtBRL(m.despesasCents)}</span>
                    <span className="text-slate-500">💸 Repasses feitos</span>
                    <span className="text-right tabular-nums text-emerald-700">{fmtBRL(m.paidCents)}</span>
                  </div>
                </div>
              ))}
              <p className="text-center text-[11px] text-slate-500">
                ✅ Total já repassado: <b className="tabular-nums">{fmtBRL(summary.totals.paidCents)}</b>
              </p>
            </div>
            <div className="flex gap-2 border-t border-slate-200 px-5 py-3.5">
              <button
                onClick={() => void copiarBalanco()}
                className={`flex-1 rounded-lg py-2.5 text-sm font-semibold text-white transition ${
                  copied ? "bg-emerald-600" : "bg-slate-900 hover:bg-slate-800"
                }`}
              >
                {copied ? "✓ Copiado! Cole no WhatsApp" : "📋 Copiar texto formatado"}
              </button>
              <button
                onClick={() => setShowBalanco(false)}
                className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-600 hover:border-slate-300"
              >
                Fechar
              </button>
            </div>
            <p className="pb-3 text-center text-[10px] text-slate-400">
              O texto copiado sai com negrito e emojis prontos para o WhatsApp. Ou tire um print
              deste cartão e envie como imagem.
            </p>
          </div>
        </>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Total entrado" value={fmtBRL(summary.totals.grossCents)} />
        <StatTile label="Honorários (5%)" value={fmtBRL(summary.totals.feeCents)} hint="advogado" />
        <StatTile label="Despesas" value={fmtBRL(summary.totals.despesasCents)} hint="descontam da divisão" />
        <StatTile label="Já repassado" value={fmtBRL(summary.totals.paidCents)} />
        <StatTile label="A repassar" value={fmtBRL(aRepassar)} hint="créditos ainda não pagos" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <MonthBars
          title="Entradas mês a mês (bruto)"
          color={CHART_ENTRADAS}
          data={summary.months.map((m) => ({ month: m.month, cents: m.grossCents }))}
        />
        <MonthBars
          title="Custos advocatícios mês a mês (5%)"
          color={CHART_HONORARIOS}
          data={summary.months.map((m) => ({ month: m.month, cents: m.feeCents }))}
        />
        <MonthBars
          title="Despesas mês a mês (por vencimento)"
          color={CHART_DESPESAS}
          data={summary.months.map((m) => ({ month: m.month, cents: m.despesasCents }))}
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wider text-slate-500">
              <th className="px-4 py-3">Membro</th>
              <th className="px-4 py-3">Papel</th>
              <th className="px-4 py-3 text-right">Creditado</th>
              <th className="px-4 py-3 text-right">Recebido</th>
              <th className="px-4 py-3 text-right">Saldo a receber</th>
            </tr>
          </thead>
          <tbody>
            {summary.perMember.map((m) => (
              <tr key={m.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2.5 font-medium text-slate-800">
                  {m.name}
                  {!m.active && <span className="ml-2 text-[10px] text-slate-400">(inativo)</span>}
                </td>
                <td className="px-4 py-2.5 text-slate-500">{ROLE_LABEL[m.role] ?? m.role}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmtBRL(m.creditCents)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmtBRL(m.paidCents)}</td>
                <td
                  className={`px-4 py-2.5 text-right font-semibold tabular-nums ${
                    m.saldoCents > 0 ? "text-amber-700" : "text-emerald-700"
                  }`}
                >
                  {fmtBRL(m.saldoCents)}
                </td>
              </tr>
            ))}
            {summary.perMember.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center italic text-slate-400">
                  Cadastre os membros na aba “Membros”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Entries (admin) ─────────────────────────────────────────────────
function LancamentosView({ members }: { members: Member[] }) {
  const [receitas, setReceitas] = useState<Receita[] | null>(null);
  const [repasses, setRepasses] = useState<Repasse[] | null>(null);
  const [despesas, setDespesas] = useState<Despesa[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // receita form
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10));
  const [savingR, setSavingR] = useState(false);

  // despesa form
  const [despDescricao, setDespDescricao] = useState("");
  const [despValor, setDespValor] = useState("");
  const [despVenc, setDespVenc] = useState(() => new Date().toISOString().slice(0, 10));
  const [savingD, setSavingD] = useState(false);

  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [r1, r2, r3] = await Promise.all([
        jfetch<{ receitas: Receita[] }>("/api/inventario/receitas"),
        jfetch<{ repasses: Repasse[] }>("/api/inventario/repasses"),
        jfetch<{ despesas: Despesa[] }>("/api/inventario/despesas"),
      ]);
      setReceitas(r1.receitas);
      setRepasses(r2.repasses);
      setDespesas(r3.despesas);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const heirs = members.filter((m) => m.active && m.role === "HEIR");
  const cents = parseBRL(valor);
  // Pending despesas of the chosen month, which will make up the deduction on the new entry.
  const pendingMonth = (despesas ?? []).filter(
    (d) => !d.receitaId && d.dueAt.slice(0, 7) === data.slice(0, 7),
  );
  const pendingCents = pendingMonth.reduce((a, d) => a + d.amountCents, 0);
  const preview = Number.isFinite(cents) && cents > 0 && heirs.length > 0;
  const fee = preview ? Math.round((cents * 5) / 100) : 0;
  const perHeir = preview ? Math.max(Math.floor((cents - fee - pendingCents) / heirs.length), 0) : 0;

  /** How much of a member's share in this receita has already been paid out (linked repasses). */
  function paidFor(r: Receita, memberId: string): number {
    return r.repasses.filter((p) => p.memberId === memberId).reduce((a, p) => a + p.amountCents, 0);
  }

  /** Marks a member's share as paid (repasse of the outstanding amount, linked to the receita). */
  async function quickPay(r: Receita, share: Receita["shares"][number]) {
    const remaining = share.amountCents - paidFor(r, share.memberId);
    if (remaining <= 0) return;
    if (!confirm(`Registrar repasse de ${fmtBRL(remaining)} para ${share.memberName} (${r.descricao})?`)) return;
    try {
      await jfetch("/api/inventario/repasses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId: share.memberId,
          amountCents: remaining,
          paidAt: new Date().toISOString().slice(0, 10),
          nota: `Quinhão: ${r.descricao}`,
          receitaId: r.id,
        }),
      });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao registrar repasse.");
    }
  }

  async function saveReceita(e: React.FormEvent) {
    e.preventDefault();
    if (savingR || !preview || !descricao.trim()) return;
    setSavingR(true);
    setErr(null);
    try {
      await jfetch("/api/inventario/receitas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ descricao: descricao.trim(), grossCents: cents, receivedAt: data }),
      });
      setDescricao("");
      setValor("");
      await load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Erro ao lançar.");
    } finally {
      setSavingR(false);
    }
  }

  async function saveDespesa(e: React.FormEvent) {
    e.preventDefault();
    const c = parseBRL(despValor);
    if (savingD || !despDescricao.trim() || !Number.isFinite(c) || c <= 0) return;
    setSavingD(true);
    setErr(null);
    setInfo(null);
    try {
      const r = await jfetch<{ message?: string }>("/api/inventario/despesas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ descricao: despDescricao.trim(), amountCents: c, dueAt: despVenc }),
      });
      setInfo(r.message ?? "Despesa registrada.");
      setDespDescricao("");
      setDespValor("");
      await load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Erro ao lançar despesa.");
    } finally {
      setSavingD(false);
    }
  }

  async function delDespesa(id: string) {
    if (!confirm("Excluir esta despesa? Se estiver descontada numa entrada, a divisão será recalculada.")) return;
    setErr(null);
    try {
      await jfetch(`/api/inventario/despesas/${id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao excluir despesa.");
    }
  }

  async function delReceita(id: string) {
    if (!confirm("Excluir esta receita? Os quinhões saem e as despesas descontadas voltam a pendentes.")) return;
    await fetch(`/api/inventario/receitas/${id}`, { method: "DELETE" });
    await load();
  }

  async function delRepasse(id: string) {
    if (!confirm("Excluir este repasse?")) return;
    await fetch(`/api/inventario/repasses/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="space-y-6">
      {err && <ErrorBox msg={err} />}
      {info && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {info}
        </p>
      )}

      {/* New receita */}
      <form onSubmit={saveReceita} className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-bold text-slate-800">➕ Registrar entrada de receita</h2>
        <div className="grid gap-3 sm:grid-cols-[1fr_140px_150px_auto]">
          <input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Descrição (ex.: Parcela 12/48, venda do imóvel)"
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
          <input
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder="Valor (R$)"
            inputMode="decimal"
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
          <input
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-indigo-400"
          />
          <button
            type="submit"
            disabled={savingR || !preview || !descricao.trim()}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-40"
          >
            {savingR ? "Lançando…" : "Lançar"}
          </button>
        </div>
        {preview && (
          <p className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-[11px] text-slate-700">
            <b>Divisão automática:</b> honorários do advogado (5%) ={" "}
            <b className="tabular-nums">{fmtBRL(fee)}</b>
            {pendingCents > 0 && (
              <>
                <span className="mx-1.5 text-slate-300">·</span>
                despesas do mês ({pendingMonth.length}) ={" "}
                <b className="tabular-nums text-rose-700">−{fmtBRL(pendingCents)}</b>
              </>
            )}
            <span className="mx-1.5 text-slate-300">·</span>
            cada herdeiro ({heirs.length}) recebe <b className="tabular-nums">{fmtBRL(perHeir)}</b>
          </p>
        )}
        {heirs.length === 0 && (
          <p className="mt-3 text-[11px] text-amber-700">
            Cadastre os herdeiros na aba “Membros” antes de lançar receitas.
          </p>
        )}
      </form>

      {/* New despesa */}
      <form onSubmit={saveDespesa} className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-bold text-slate-800">➖ Registrar despesa</h2>
        <div className="grid gap-3 sm:grid-cols-[1fr_140px_150px_auto]">
          <input
            value={despDescricao}
            onChange={(e) => setDespDescricao(e.target.value)}
            placeholder="Descrição (ex.: Custas do processo, ITBI…)"
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
          <input
            value={despValor}
            onChange={(e) => setDespValor(e.target.value)}
            placeholder="Valor (R$)"
            inputMode="decimal"
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
          <input
            type="date"
            value={despVenc}
            onChange={(e) => setDespVenc(e.target.value)}
            title="Data de vencimento (desconta da entrada deste mês)"
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-indigo-400"
          />
          <button
            type="submit"
            disabled={savingD || !despDescricao.trim() || !(parseBRL(despValor) > 0)}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-40"
          >
            {savingD ? "Lançando…" : "Lançar despesa"}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          A despesa desconta da entrada do <b>mesmo mês do vencimento</b>, como os 5% do advogado.
          Sem entrada nesse mês, fica pendente e compõe o próximo lançamento.
        </p>
      </form>

      {/* Recorded despesas */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-bold text-slate-800">
          Despesas registradas
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wider text-slate-500">
              <th className="px-4 py-2.5">Vencimento</th>
              <th className="px-4 py-2.5">Descrição</th>
              <th className="px-4 py-2.5 text-right">Valor</th>
              <th className="px-4 py-2.5">Situação</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {(despesas ?? []).map((d) => (
              <tr key={d.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2.5 text-slate-500">{fmtDate(d.dueAt)}</td>
                <td className="px-4 py-2.5 font-medium text-slate-800">{d.descricao}</td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-rose-700">
                  −{fmtBRL(d.amountCents)}
                </td>
                <td className="px-4 py-2.5">
                  {d.receitaId ? (
                    <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                      Descontada em “{d.receitaDescricao}”
                    </span>
                  ) : (
                    <span className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                      Pendente: desconta na próxima entrada do mês
                    </span>
                  )}
                </td>
                <td className="px-2 py-2.5 text-right">
                  <button
                    onClick={() => void delDespesa(d.id)}
                    title="Excluir"
                    className="rounded px-2 py-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {despesas && despesas.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center italic text-slate-400">
                  Nenhuma despesa registrada ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Recorded receitas */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-bold text-slate-800">
          Entradas registradas
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wider text-slate-500">
              <th className="px-4 py-2.5">Data</th>
              <th className="px-4 py-2.5">Descrição</th>
              <th className="px-4 py-2.5 text-right">Bruto</th>
              <th className="px-4 py-2.5 text-right">Advogado (5%)</th>
              <th className="px-4 py-2.5 text-right">Despesas</th>
              <th className="px-4 py-2.5 text-right">Por herdeiro</th>
              <th className="px-4 py-2.5 text-right">Repassado</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {(receitas ?? []).map((r) => {
              const feeR = r.shares.filter((s) => s.kind === "LAWYER_FEE").reduce((a, s) => a + s.amountCents, 0);
              const heirShares = r.shares.filter((s) => s.kind === "HEIR_SHARE");
              const perHeirR = heirShares[0]?.amountCents ?? 0;
              const despTotal = r.despesas.reduce((a, d) => a + d.amountCents, 0);
              const paidTotal = r.repasses.reduce((a, p) => a + p.amountCents, 0);
              const complete = paidTotal >= r.grossCents - despTotal;
              const isOpen = expanded === r.id;
              return (
                <Fragment key={r.id}>
                  <tr
                    onClick={() => setExpanded(isOpen ? null : r.id)}
                    className="cursor-pointer border-b border-slate-100 transition hover:bg-slate-50/60 last:border-0"
                    title="Clique para ver o repasse por pessoa"
                  >
                    <td className="px-4 py-2.5 text-slate-500">
                      <span className="mr-1.5 inline-block text-[9px] text-slate-400">{isOpen ? "▼" : "▶"}</span>
                      {fmtDate(r.receivedAt)}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-slate-800">{r.descricao}</td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{fmtBRL(r.grossCents)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-amber-800">{fmtBRL(feeR)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-rose-700">
                      {despTotal > 0 ? `−${fmtBRL(despTotal)}` : <span className="text-slate-300">-</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {fmtBRL(perHeirR)}
                      <span className="ml-1 text-[10px] text-slate-400">×{heirShares.length}</span>
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right font-semibold tabular-nums ${
                        complete ? "text-emerald-700" : paidTotal > 0 ? "text-amber-700" : "text-slate-400"
                      }`}
                    >
                      {complete ? "✓ " : ""}
                      {fmtBRL(paidTotal)}
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void delReceita(r.id);
                        }}
                        title="Excluir"
                        className="rounded px-2 py-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-slate-100 bg-slate-50/50 last:border-0">
                      <td colSpan={8} className="px-6 py-3">
                        <div className="space-y-1.5">
                          {r.despesas.map((d) => (
                            <div key={d.id} className="flex flex-wrap items-center gap-2">
                              <span className="w-24 font-medium text-slate-800">Despesa</span>
                              <span className="w-24 truncate text-[10px] uppercase tracking-wider text-slate-400">
                                {d.descricao}
                              </span>
                              <span className="w-24 text-right tabular-nums text-rose-700">
                                −{fmtBRL(d.amountCents)}
                              </span>
                              <span className="rounded border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                                Descontada antes da divisão
                              </span>
                            </div>
                          ))}
                          {r.shares.map((s) => {
                            const paid = paidFor(r, s.memberId);
                            const remaining = s.amountCents - paid;
                            return (
                              <div key={s.id} className="flex flex-wrap items-center gap-2">
                                <span className="w-24 font-medium text-slate-800">{s.memberName}</span>
                                <span className="w-24 text-[10px] uppercase tracking-wider text-slate-400">
                                  {s.kind === "LAWYER_FEE" ? "Honorários" : "Quinhão"}
                                </span>
                                {s.memberPix ? (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void navigator.clipboard.writeText(s.memberPix!);
                                    }}
                                    title={`Copiar PIX: ${s.memberPix}`}
                                    className="max-w-[140px] truncate rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] text-emerald-800 hover:bg-emerald-100"
                                  >
                                    ⧉ {s.memberPix}
                                  </button>
                                ) : (
                                  <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800">
                                    sem PIX
                                  </span>
                                )}
                                <span className="w-24 text-right tabular-nums text-slate-600">
                                  {fmtBRL(s.amountCents)}
                                </span>
                                {remaining <= 0 ? (
                                  <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                                    ✓ Pago
                                  </span>
                                ) : (
                                  <>
                                    <span className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800 tabular-nums">
                                      {paid > 0 ? `Falta ${fmtBRL(remaining)}` : "Pendente"}
                                    </span>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void quickPay(r, s);
                                      }}
                                      className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[10px] font-semibold text-indigo-700 transition hover:bg-indigo-100"
                                    >
                                      💸 Marcar pago ({fmtBRL(remaining)})
                                    </button>
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {receitas && receitas.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center italic text-slate-400">
                  Nenhuma entrada registrada ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Repasses made */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-bold text-slate-800">
          Repasses efetuados
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wider text-slate-500">
              <th className="px-4 py-2.5">Data</th>
              <th className="px-4 py-2.5">Para</th>
              <th className="px-4 py-2.5">Referente</th>
              <th className="px-4 py-2.5 text-right">Valor</th>
              <th className="px-4 py-2.5">Nota</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {(repasses ?? []).map((r) => (
              <tr key={r.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2.5 text-slate-500">{fmtDate(r.paidAt)}</td>
                <td className="px-4 py-2.5 font-medium text-slate-800">{r.memberName}</td>
                <td className="px-4 py-2.5 text-slate-500">{r.receitaDescricao ?? "-"}</td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{fmtBRL(r.amountCents)}</td>
                <td className="px-4 py-2.5 text-slate-500">{r.nota ?? "-"}</td>
                <td className="px-2 py-2.5 text-right">
                  <button
                    onClick={() => void delRepasse(r.id)}
                    title="Excluir"
                    className="rounded px-2 py-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {repasses && repasses.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center italic text-slate-400">
                  Nenhum repasse registrado ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Documents (everyone) ────────────────────────────────────────────
function DocumentsView({ isAdmin }: { isAdmin: boolean }) {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await jfetch<{ documents: Doc[] }>("/api/inventario/documents");
      setDocs(r.documents);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function uploadMany(files: File[]) {
    if (files.length === 0 || uploading) return;
    setUploading(true);
    setErr(null);
    const failures: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setProgress(
        files.length > 1 ? `Enviando ${i + 1}/${files.length}: ${file.name}` : `Enviando ${file.name}…`,
      );
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/inventario/documents", { method: "POST", body: fd });
        if (!res.ok) {
          const d = (await res.json().catch(() => ({}))) as { message?: string };
          throw new Error(d.message ?? "erro no upload");
        }
      } catch (e) {
        failures.push(`${file.name}: ${e instanceof Error ? e.message : "erro"}`);
      }
      await load(); // the list refreshes as each file lands
    }
    setProgress(null);
    setUploading(false);
    if (failures.length) setErr(`Falharam ${failures.length} ficheiro(s): ${failures.join(" · ")}`);
  }

  async function del(id: string, name: string) {
    if (!confirm(`Excluir o documento "${name}"?`)) return;
    await fetch(`/api/inventario/documents/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="space-y-4">
      {err && <ErrorBox msg={err} />}
      <label
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void uploadMany(Array.from(e.dataTransfer.files));
        }}
        className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-white px-4 py-6 text-xs font-semibold text-slate-500 transition hover:border-indigo-300 hover:text-indigo-700"
      >
        <input
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            void uploadMany(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        {uploading
          ? progress ?? "Enviando…"
          : "📎 Carregar documentos (vários de uma vez, qualquer formato, máx. 50 MB cada)"}
      </label>

      <div className="space-y-2">
        {(docs ?? []).map((d) => (
          <div
            key={d.id}
            className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3"
          >
            <span className="text-xl">{fileIcon(d.mimeType)}</span>
            <div className="min-w-0 flex-1">
              <a
                href={`/api/inventario/documents/${d.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate text-sm font-medium text-slate-800 hover:text-indigo-700"
              >
                {d.filename}
              </a>
              <div className="text-[11px] text-slate-400">
                {fmtSize(d.size)} · enviado por {d.uploadedByName} · {fmtDate(d.createdAt)}
              </div>
            </div>
            <a
              href={`/api/inventario/documents/${d.id}`}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:border-indigo-300 hover:text-indigo-700"
            >
              ⬇ Baixar
            </a>
            {isAdmin && (
              <button
                onClick={() => void del(d.id, d.filename)}
                title="Excluir"
                className="rounded px-2 py-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-600"
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {docs && docs.length === 0 && (
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-xs italic text-slate-400">
            Nenhum documento carregado ainda.
          </p>
        )}
        {!docs && !err && <Loading />}
      </div>
    </div>
  );
}

// ── Extrato (member / admin "view as") ──────────────────────────────
function ExtratoView({ viewAsId }: { viewAsId?: string }) {
  const [extrato, setExtrato] = useState<Extrato | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const url = viewAsId
      ? `/api/inventario/extrato?viewAs=${encodeURIComponent(viewAsId)}`
      : "/api/inventario/extrato";
    jfetch<{ extrato: Extrato }>(url)
      .then((r) => setExtrato(r.extrato))
      .catch((e) => setErr(e instanceof Error ? e.message : "Erro"));
  }, [viewAsId]);

  if (err) return <ErrorBox msg={err} />;
  if (!extrato) return <Loading />;

  const isLawyer = extrato.member.role === "LAWYER";

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile
          label={isLawyer ? "Honorários acumulados" : "Total creditado a você"}
          value={fmtBRL(extrato.totalCreditosCents)}
        />
        <StatTile label="Já recebido" value={fmtBRL(extrato.totalRecebidoCents)} />
        <StatTile
          label="Saldo a receber"
          value={fmtBRL(extrato.saldoCents)}
          hint={extrato.saldoCents > 0 ? "aguardando repasse" : "tudo em dia"}
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-bold text-slate-800">
          Créditos: {isLawyer ? "honorários de 5% sobre cada entrada" : "sua parte em cada entrada"}
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wider text-slate-500">
              <th className="px-4 py-2.5">Data</th>
              <th className="px-4 py-2.5">Origem</th>
              <th className="px-4 py-2.5 text-right">Entrada bruta</th>
              <th className="px-4 py-2.5 text-right">{isLawyer ? "Honorários (5%)" : "Sua parte"}</th>
            </tr>
          </thead>
          <tbody>
            {extrato.creditos.map((c) => (
              <tr key={c.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2.5 text-slate-500">{fmtDate(c.receivedAt)}</td>
                <td className="px-4 py-2.5 font-medium text-slate-800">{c.descricao}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">
                  {fmtBRL(c.receitaGrossCents)}
                </td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{fmtBRL(c.amountCents)}</td>
              </tr>
            ))}
            {extrato.creditos.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center italic text-slate-400">
                  Nenhum crédito ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-bold text-slate-800">
          Repasses recebidos
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wider text-slate-500">
              <th className="px-4 py-2.5">Data</th>
              <th className="px-4 py-2.5 text-right">Valor</th>
              <th className="px-4 py-2.5">Nota</th>
            </tr>
          </thead>
          <tbody>
            {extrato.repasses.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2.5 text-slate-500">{fmtDate(r.paidAt)}</td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-emerald-700">
                  {fmtBRL(r.amountCents)}
                </td>
                <td className="px-4 py-2.5 text-slate-500">{r.nota ?? "-"}</td>
              </tr>
            ))}
            {extrato.repasses.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center italic text-slate-400">
                  Nenhum repasse recebido ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-center text-[10px] text-slate-400">
        De cada entrada são descontados os honorários do advogado (5%) e as despesas do mês; o
        restante é dividido em partes iguais entre os herdeiros. Você vê apenas o seu extrato.
      </p>
    </div>
  );
}

// ── Members (admin) ─────────────────────────────────────────────────
function MembrosView({ members, reload }: { members: Member[]; reload: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("HEIR");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [codes, setCodes] = useState<Record<string, string>>({});

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setErr(null);
    try {
      await jfetch("/api/inventario/admin/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, role }),
      });
      setName("");
      setPhone("");
      setRole("HEIR");
      await reload();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Erro ao cadastrar.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(m: Member) {
    await fetch(`/api/inventario/admin/members/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !m.active }),
    });
    await reload();
  }

  async function genCode(m: Member) {
    try {
      const r = await jfetch<{ code: string }>("/api/inventario/admin/gen-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: m.id }),
      });
      setCodes((prev) => ({ ...prev, [m.id]: r.code }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao gerar código.");
    }
  }

  async function resetPassword(m: Member) {
    if (
      !confirm(
        `Resetar a senha de ${m.name}?\n\nO acesso será BLOQUEADO imediatamente (todas as sessões caem). ` +
          `Depois use "Liberar acesso" para gerar um novo código de primeiro acesso.`,
      )
    )
      return;
    try {
      await jfetch(`/api/inventario/admin/members/${m.id}/reset`, { method: "POST" });
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao resetar.");
    }
  }

  async function setPixAdmin(m: Member) {
    const key = window.prompt(`Chave PIX de ${m.name} (vazio remove):`, m.pixKey ?? "");
    if (key === null) return;
    await fetch(`/api/inventario/admin/members/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pixKey: key }),
    });
    await reload();
  }

  async function unblock(m: Member) {
    try {
      await jfetch(`/api/inventario/admin/members/${m.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocked: false }),
      });
      await reload();
      await genCode(m); // leaves the first-access code ready to send
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao liberar.");
    }
  }

  return (
    <div className="space-y-5">
      {err && <ErrorBox msg={err} />}

      <form onSubmit={add} className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-bold text-slate-800">➕ Cadastrar membro</h2>
        <div className="grid gap-3 sm:grid-cols-[1fr_180px_150px_auto]">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome"
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="WhatsApp c/ DDD"
            inputMode="tel"
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-400"
          >
            <option value="HEIR">Herdeiro(a)</option>
            <option value="LAWYER">Advogado</option>
          </select>
          <button
            type="submit"
            disabled={saving || !name.trim() || phone.replace(/\D/g, "").length < 10}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-40"
          >
            {saving ? "Salvando…" : "Cadastrar"}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          Sem DDI, assume-se Brasil (55). A divisão das receitas usa os herdeiros <b>ativos</b> no
          momento do lançamento.
        </p>
      </form>

      <div className="space-y-2">
        {members.map((m) => (
          <div key={m.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-slate-800">
                  {m.name}
                  <span
                    className={`ml-2 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                      m.role === "LAWYER"
                        ? "border border-amber-200 bg-amber-50 text-amber-800"
                        : "border border-indigo-200 bg-indigo-50 text-indigo-700"
                    }`}
                  >
                    {ROLE_LABEL[m.role] ?? m.role}
                  </span>
                  {!m.active && (
                    <span className="ml-2 rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-500">
                      inativo
                    </span>
                  )}
                  {m.blocked ? (
                    <span className="ml-2 rounded border border-rose-300 bg-rose-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-rose-700">
                      🔒 bloqueado (reset de senha)
                    </span>
                  ) : m.hasPassword ? (
                    <span className="ml-2 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-700">
                      senha ativa
                    </span>
                  ) : (
                    <span className="ml-2 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-700">
                      1º acesso pendente
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                  <span className="tabular-nums">+{m.phone}</span>
                  {m.pixKey ? (
                    <button
                      onClick={() => void navigator.clipboard.writeText(m.pixKey!)}
                      title="Copiar chave PIX"
                      className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] text-emerald-800 hover:bg-emerald-100"
                    >
                      PIX: {m.pixKey} ⧉
                    </button>
                  ) : (
                    <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                      PIX pendente
                    </span>
                  )}
                  <button
                    onClick={() => void setPixAdmin(m)}
                    className="text-slate-400 underline-offset-2 hover:text-slate-700 hover:underline"
                  >
                    {m.pixKey ? "editar" : "definir"}
                  </button>
                </div>
              </div>
              {m.blocked ? (
                <button
                  onClick={() => void unblock(m)}
                  className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-100"
                >
                  🔓 Liberar acesso
                </button>
              ) : m.hasPassword ? (
                <button
                  onClick={() => void resetPassword(m)}
                  className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-100"
                >
                  ♻ Resetar senha
                </button>
              ) : (
                <button
                  onClick={() => void genCode(m)}
                  className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[11px] font-semibold text-indigo-700 transition hover:bg-indigo-100"
                >
                  🔑 Gerar código
                </button>
              )}
              <button
                onClick={() => void toggleActive(m)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300"
              >
                {m.active ? "Desativar" : "Reativar"}
              </button>
            </div>
            {codes[m.id] && (
              <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                Código de acesso (válido 10 min):
                <b className="text-base tracking-[0.3em]">{codes[m.id]}</b>
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(codes[m.id])}
                  className="ml-auto rounded border border-emerald-300 px-2 py-0.5 text-[10px] font-semibold hover:bg-emerald-100"
                >
                  Copiar
                </button>
              </div>
            )}
          </div>
        ))}
        {members.length === 0 && (
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-xs italic text-slate-400">
            Nenhum membro cadastrado. Cadastre os 3 irmãos, você e o advogado.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Access log (admin) ──────────────────────────────────────────────
const ACTION_LABEL: Record<string, string> = {
  CODE_SENT: "Código enviado (WhatsApp)",
  CODE_CREATED: "Código gerado",
  CODE_MANUAL: "Código gerado pelo admin",
  CODE_DENIED: "Tentativa com número não cadastrado",
  CODE_RATE_LIMIT: "Limite de códigos atingido",
  CODE_SEND_ERROR: "Falha no envio WhatsApp",
  LOGIN_OK: "Entrou no portal",
  LOGIN_FAIL: "Falha de login (código/senha)",
  LOGIN_BLOCKED: "Tentou entrar com acesso bloqueado",
  PASSWORD_SET: "Criou/definiu senha",
  PASSWORD_RESET: "Admin resetou senha (acesso bloqueado)",
  PIX_SET: "Cadastrou/alterou chave PIX",
  LOGOUT: "Saiu",
  DOC_UPLOAD: "Carregou documento",
  DOC_UPLOAD_ERROR: "Falha no upload (S3)",
  DOC_DOWNLOAD: "Baixou documento",
  DOC_DELETE: "Excluiu documento",
  EXTRATO_VIEW: "Consultou extrato",
  IMPERSONATE: "Admin viu como membro",
  RECEITA_CREATE: "Lançou receita",
  RECEITA_DELETE: "Excluiu receita",
  DESPESA_CREATE: "Lançou despesa",
  DESPESA_DELETE: "Excluiu despesa",
  REPASSE_CREATE: "Registrou repasse",
  REPASSE_DELETE: "Excluiu repasse",
  MEMBER_CREATE: "Cadastrou membro",
  MEMBER_UPDATE: "Editou membro",
  MEMBER_DEACTIVATE: "Desativou membro",
  MEMBER_DELETE: "Removeu membro",
};

function AcessosView() {
  const [log, setLog] = useState<LogRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    jfetch<{ log: LogRow[] }>("/api/inventario/admin/log")
      .then((r) => setLog(r.log))
      .catch((e) => setErr(e instanceof Error ? e.message : "Erro"));
  }, []);

  if (err) return <ErrorBox msg={err} />;
  if (!log) return <Loading />;

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-3 text-sm font-bold text-slate-800">
        Registro de acessos e ações <span className="font-normal text-slate-400">(últimos 300)</span>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wider text-slate-500">
            <th className="px-4 py-2.5">Quando</th>
            <th className="px-4 py-2.5">Quem</th>
            <th className="px-4 py-2.5">Ação</th>
            <th className="px-4 py-2.5">Detalhe</th>
            <th className="px-4 py-2.5">IP</th>
          </tr>
        </thead>
        <tbody>
          {log.map((r) => (
            <tr key={r.id} className="border-b border-slate-100 last:border-0">
              <td className="whitespace-nowrap px-4 py-2 tabular-nums text-slate-500">
                {fmtDateTime(r.createdAt)}
              </td>
              <td className="px-4 py-2 font-medium text-slate-800">{r.actor}</td>
              <td className="px-4 py-2 text-slate-600">{ACTION_LABEL[r.action] ?? r.action}</td>
              <td className="max-w-[260px] truncate px-4 py-2 text-slate-500">{r.detail ?? "-"}</td>
              <td className="px-4 py-2 tabular-nums text-slate-400">{r.ip ?? "-"}</td>
            </tr>
          ))}
          {log.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center italic text-slate-400">
                Nenhum acesso registrado ainda.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── PIX key (member) ────────────────────────────────────────────────
function PixModal({
  current,
  onClose,
  onSaved,
}: {
  current: string | null;
  onClose: () => void;
  onSaved: (key: string) => void;
}) {
  const [key, setKey] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy || key.trim().length < 3) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await jfetch<{ pixKey: string }>("/api/inventario/pix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pixKey: key }),
      });
      onSaved(r.pixKey);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Erro ao salvar.");
      setBusy(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-30 bg-slate-900/30 backdrop-blur-sm" onClick={onClose} />
      <form
        onSubmit={save}
        className="fixed left-1/2 top-1/2 z-40 w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
      >
        <h3 className="mb-1 text-base font-bold text-slate-900">🔑 Minha chave PIX</h3>
        <p className="mb-4 text-xs leading-relaxed text-slate-500">
          É para esta chave que os seus repasses serão enviados. Pode ser CPF, telefone, e-mail ou
          chave aleatória.
        </p>
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Ex.: 000.000.000-00 ou email@exemplo.com"
          autoFocus
          className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        />
        {err && (
          <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {err}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy || key.trim().length < 3}
            className="flex-1 rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-40"
          >
            {busy ? "Salvando…" : "Salvar chave PIX"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-600 hover:border-slate-300"
          >
            Cancelar
          </button>
        </div>
      </form>
    </>
  );
}

// ── Install as an app (PWA) ─────────────────────────────────────────
type InstallPromptEvent = Event & { prompt: () => Promise<void> };

function InstallHelp() {
  const [open, setOpen] = useState(false);
  const [installEvt, setInstallEvt] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-indigo-300 hover:text-indigo-700"
      >
        📲 Instalar app
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-30 bg-slate-900/30 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="fixed left-1/2 top-1/2 z-40 max-h-[90vh] w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-base font-bold text-slate-900">📲 Instalar no telemóvel</h3>
              <button
                onClick={() => setOpen(false)}
                className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                ✕
              </button>
            </div>
            <p className="mb-4 text-xs leading-relaxed text-slate-500">
              O portal funciona como um aplicativo: fica com ícone 🌟 na tela inicial e abre em
              janela própria, sem barra do navegador.
            </p>

            {installEvt && (
              <button
                onClick={() => void installEvt.prompt()}
                className="mb-4 w-full rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                ⚡ Instalar agora (1 toque)
              </button>
            )}

            <div className="space-y-4 text-xs">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                <p className="mb-2 font-bold text-slate-800"> iPhone (Safari)</p>
                <ol className="list-decimal space-y-1.5 pl-4 text-slate-600">
                  <li>
                    Abra <b>o endereço do portal</b> no <b>Safari</b>
                  </li>
                  <li>
                    Toque no botão <b>Compartilhar</b>{" "}
                    <span className="rounded border border-slate-300 bg-white px-1">⬆</span> (quadrado
                    com seta, na barra de baixo)
                  </li>
                  <li>
                    Role a lista e toque em <b>“Adicionar à Tela de Início”</b>
                  </li>
                  <li>
                    Toque em <b>Adicionar</b>, e o 🌟 aparece na tela
                  </li>
                </ol>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                <p className="mb-2 font-bold text-slate-800">🤖 Android (Chrome)</p>
                <ol className="list-decimal space-y-1.5 pl-4 text-slate-600">
                  <li>
                    Abra <b>o endereço do portal</b> no <b>Chrome</b>
                  </li>
                  <li>
                    Toque no menu <b>⋮</b> (canto superior direito)
                  </li>
                  <li>
                    Toque em <b>“Adicionar à tela inicial”</b> (ou <b>“Instalar app”</b>)
                  </li>
                  <li>
                    Confirme em <b>Adicionar / Instalar</b>
                  </li>
                </ol>
              </div>
            </div>
            <p className="mt-3 text-center text-[10px] text-slate-400">
              Depois de instalado, entre uma vez com telefone e senha; a sessão fica guardada por 30
              dias.
            </p>
          </div>
        </>
      )}
    </>
  );
}

// ── Small helpers ───────────────────────────────────────────────────
function Loading() {
  return <p className="py-10 text-center text-xs italic text-slate-400">Carregando…</p>;
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{msg}</p>
  );
}
