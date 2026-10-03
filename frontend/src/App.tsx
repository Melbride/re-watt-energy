import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  api,
  ApiError,
  Category,
  jsonBody,
  Dispute,
  Listing,
  Match,
  Notification,
  Requirement,
  Transaction,
  User,
} from "./api";

type View = "overview" | "supply" | "listings" | "requirements" | "matches" | "transactions" | "notifications" | "disputes" | "admin";

const TOKEN_KEY = "rewatt.accessToken";
const conditions = ["dry", "wet", "mixed", "contaminated", "processed", "unsorted", "unknown"];
const views: View[] = ["overview", "supply", "listings", "requirements", "matches", "transactions", "notifications", "disputes", "admin"];

function viewFromPath(pathname: string): View {
  const lastPart = pathname.split("/").filter(Boolean).at(-1);
  return views.includes(lastPart as View) ? (lastPart as View) : "overview";
}

function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<User | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [publicDataLoading, setPublicDataLoading] = useState(true);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [pendingUsers, setPendingUsers] = useState<
    Array<{ user_id: number; name: string; email: string; role: string; business_name?: string; county?: string }>
  >([]);
  const view = viewFromPath(location.pathname);
  const setView = useCallback((nextView: View) => navigate(`/app/${nextView}`), [navigate]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [authLoading, setAuthLoading] = useState(() => Boolean(sessionStorage.getItem(TOKEN_KEY)));
  const [authMode, setAuthMode] = useState<"login" | "register">("register");
  const [role, setRole] = useState<"supplier" | "buyer">("supplier");
  const [showAuth, setShowAuth] = useState(false);

  const loadPublicData = useCallback(async () => {
    setPublicDataLoading(true);
    try {
      const [catalog, supply] = await Promise.all([
        api<Category[]>("/catalog"),
        api<Listing[]>("/listings"),
      ]);
      setCategories(catalog);
      setListings(supply);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load marketplace data.");
    } finally {
      setPublicDataLoading(false);
    }
  }, []);

  const loadWorkspace = useCallback(
    async (activeToken: string, activeUser: User) => {
      setWorkspaceLoading(true);
      try {
      const [supply, ownRequirements, ownMatches, ownTransactions, userNotifications, userDisputes] = await Promise.all([
        api<Listing[]>("/listings", {}, activeToken),
        activeUser.role === "buyer" || activeUser.role === "admin"
          ? api<Requirement[]>("/requirements", {}, activeToken)
          : Promise.resolve([] as Requirement[]),
        api<Match[]>("/matches", {}, activeToken),
        api<Transaction[]>("/transactions", {}, activeToken),
        api<Notification[]>("/notifications", {}, activeToken),
        api<Dispute[]>("/disputes", {}, activeToken),
      ]);
      setListings(supply);
      setRequirements(ownRequirements);
      setMatches(ownMatches);
      setTransactions(ownTransactions);
      setNotifications(userNotifications);
      setDisputes(userDisputes);
      if (activeUser.role === "admin") {
        const pending = await api<typeof pendingUsers>(
          "/admin/verifications/pending",
          {},
          activeToken,
        );
        setPendingUsers(pending);
      }
      } finally {
        setWorkspaceLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadPublicData();
  }, [loadPublicData]);

  useEffect(() => {
    if (!token) {
      setUser(null);
      setAuthLoading(false);
      return;
    }
    let mounted = true;
    api<User>("/auth/me", {}, token)
      .then(async (activeUser) => {
        if (!mounted) return;
        setUser(activeUser);
        try {
          await loadWorkspace(token, activeUser);
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : "Could not load your workspace.");
        } finally {
          setAuthLoading(false);
        }
      })
      .catch((reason) => {
        if (mounted) {
          if (reason instanceof ApiError && reason.status === 401) {
            sessionStorage.removeItem(TOKEN_KEY);
            setToken(null);
            setUser(null);
            setError("Your session expired. Please sign in again.");
          } else {
            setError(
              reason instanceof Error
                ? reason.message
                : "Could not validate your session.",
            );
          }
          setAuthLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [token, loadWorkspace]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      if (location.pathname.startsWith("/app")) navigate("/", { replace: true });
      return;
    }
    if (!location.pathname.startsWith("/app/")) {
      navigate(`/app/${user.role === "admin" ? "admin" : "overview"}`, { replace: true });
      return;
    }
    const requestedView = location.pathname.split("/").filter(Boolean).at(-1);
    if (!views.includes(requestedView as View)) {
      navigate(`/app/${user.role === "admin" ? "admin" : "overview"}`, { replace: true });
      return;
    }
    if ((view === "listings" && user.role !== "supplier") ||
        (view === "requirements" && user.role !== "buyer") ||
        (view === "admin" && user.role !== "admin")) {
      navigate(`/app/${user.role === "admin" ? "admin" : "overview"}`, { replace: true });
    }
  }, [authLoading, location.pathname, navigate, user, view]);

  const materials = useMemo(
    () => categories.flatMap((category) => category.materials),
    [categories],
  );

  const refresh = async () => {
    await loadPublicData();
    if (token && user) await loadWorkspace(token, user);
  };

  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const path = authMode === "register" ? "/auth/register" : "/auth/login";
      const body =
        authMode === "register"
          ? {
              email: form.get("email"),
              password: form.get("password"),
              full_name: form.get("full_name"),
              role,
              phone: form.get("phone") || null,
              business_name: form.get("business_name"),
              business_type: form.get("business_type") || null,
              supplier_type: form.get("supplier_type") || null,
              county: form.get("county") || null,
            }
          : { email: form.get("email"), password: form.get("password") };
      const response = await api<{ access_token: string; user: User }>(path, {
        method: "POST",
        body: jsonBody(body),
      });
      sessionStorage.setItem(TOKEN_KEY, response.access_token);
      setToken(response.access_token);
      setUser(response.user);
      setShowAuth(false);
      setNotice(
        authMode === "register"
          ? "Your account is ready. An admin must verify your business before you can publish or transact."
          : `Welcome back, ${response.user.full_name.split(" ")[0]}.`,
      );
      setAuthLoading(false);
      navigate(`/app/${response.user.role === "admin" ? "admin" : "overview"}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  };

  const logout = () => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setAuthLoading(false);
    navigate("/");
    setRequirements([]);
    setMatches([]);
    setTransactions([]);
    setNotifications([]);
    setDisputes([]);
    setNotice("You have been signed out.");
  };

  const createListing = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setError("");
    try {
      await api("/listings", {
        method: "POST",
        body: jsonBody({
          material_id: Number(form.get("material_id")),
          title: form.get("title"),
          condition: form.get("condition"),
          quantity: Number(form.get("quantity")),
          unit: form.get("unit"),
          price_per_unit: form.get("price_per_unit")
            ? Number(form.get("price_per_unit"))
            : null,
          currency: "KES",
          county: form.get("county") || null,
          city: form.get("city") || null,
          available_from: form.get("available_from") || null,
          description: form.get("description") || null,
        }),
      }, token);
      formElement.reset();
      setNotice("Your material is now listed in the marketplace.");
      await refresh();
      setView("listings");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not publish the listing.");
    } finally {
      setBusy(false);
    }
  };

  const createRequirement = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const selectedConditions = form.getAll("conditions").map(String);
    setBusy(true);
    setError("");
    try {
      const requirement = await api<Requirement>("/requirements", {
        method: "POST",
        body: jsonBody({
          material_id: Number(form.get("material_id")),
          title: form.get("title"),
          quantity: Number(form.get("quantity")),
          unit: form.get("unit"),
          acceptable_conditions: selectedConditions,
          delivery_counties: String(form.get("delivery_counties") || "")
            .split(",")
            .map((county) => county.trim())
            .filter(Boolean),
          target_price_per_unit: form.get("target_price_per_unit")
            ? Number(form.get("target_price_per_unit"))
            : null,
          required_by: form.get("required_by") || null,
          intended_use: form.get("intended_use") || null,
          description: form.get("description") || null,
          currency: "KES",
        }),
      }, token);
      formElement.reset();
      setRequirements((current) => [requirement, ...current.filter((item) => item.id !== requirement.id)]);
      try {
        const match = await api<Match>(`/requirements/${requirement.id}/matches`, {
          method: "POST",
        }, token);
        setMatches((current) => [match, ...current.filter((item) => item.id !== match.id)]);
        setView("matches");
        setNotice(match.coverage_percent < 100
          ? `Requirement posted. Current compatible supply covers ${match.coverage_percent.toFixed(0)}%; more listings may appear later.`
          : "Requirement posted and the backend found a complete aggregated match.");
      } catch (reason) {
        if (!(reason instanceof ApiError && reason.status === 404 && reason.message.includes("No compatible active supply"))) {
          throw reason;
        }
        setNotice("Requirement posted. No compatible supply is available yet; check matches again after suppliers publish listings.");
        setView("matches");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not post your requirement.");
    } finally {
      setBusy(false);
    }
  };

  const respondToMatch = async (matchId: number, accept: boolean) => {
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ status: string; transactions: number[] }>(
        `/matches/${matchId}/respond`,
        { method: "POST", body: jsonBody({ accept }) },
        token,
      );
      setNotice(
        result.transactions.length
          ? "All suppliers accepted. Transaction records are ready for handover."
          : accept
            ? "Your response was recorded. The match will confirm when every supplier accepts."
            : "The invitation was declined.",
      );
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not respond to the match.");
    } finally {
      setBusy(false);
    }
  };

  const reviewAccount = async (userId: number, decision: "verified" | "rejected") => {
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      await api(`/admin/verifications/${userId}`, {
        method: "PATCH",
        body: jsonBody({ decision }),
      }, token);
      setNotice(`Account ${decision}.`);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update verification.");
    } finally {
      setBusy(false);
    }
  };

  const confirmReceipt = async (transactionId: number, quantity: number) => {
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      await api(`/transactions/${transactionId}/confirm-receipt`, {
        method: "POST",
        body: jsonBody({ quantity_received: quantity }),
      }, token);
      setNotice("Receipt recorded. Add the payment reference after arranging payment directly.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not confirm receipt.");
    } finally {
      setBusy(false);
    }
  };

  const recordPayment = async (transactionId: number) => {
    if (!token) return;
    const reference = window.prompt("Enter the payment reference (or leave blank if unavailable):") || "";
    setBusy(true);
    setError("");
    try {
      await api(`/transactions/${transactionId}/payments`, {
        method: "POST",
        body: jsonBody({ method: "mobile_money", reference: reference || null }),
      }, token);
      setNotice("Payment record saved. The supplier can confirm receipt of funds.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not record payment.");
    } finally {
      setBusy(false);
    }
  };

  const confirmPayment = async (paymentId: number) => {
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      await api(`/payments/${paymentId}/confirm-received`, { method: "POST" }, token);
      setNotice("Payment receipt confirmed and transaction completed.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not confirm payment.");
    } finally {
      setBusy(false);
    }
  };

  const handover = async (transactionId: number) => {
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      await api(`/transactions/${transactionId}/handover`, { method: "POST" }, token);
      setNotice("Handover recorded. The buyer can confirm the received quantity.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not record handover.");
    } finally {
      setBusy(false);
    }
  };

  const openDispute = async (transactionId: number) => {
    if (!token) return;
    const reason = window.prompt("Briefly describe the issue with this transaction:")?.trim();
    if (!reason) return;
    setBusy(true);
    setError("");
    try {
      await api(`/transactions/${transactionId}/disputes`, {
        method: "POST",
        body: jsonBody({ reason }),
      }, token);
      setNotice("Dispute opened. The other party and marketplace admins have been notified.");
      await refresh();
      setView("disputes");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not open the dispute.");
    } finally {
      setBusy(false);
    }
  };

  const sendDisputeMessage = async (disputeId: number, body: string) => {
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      await api(`/disputes/${disputeId}/messages`, {
        method: "POST",
        body: jsonBody({ body }),
      }, token);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not send the dispute update.");
    } finally {
      setBusy(false);
    }
  };

  const resolveDispute = async (disputeId: number, resolution: string, notes: string) => {
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      await api(`/disputes/${disputeId}/resolve`, {
        method: "PATCH",
        body: jsonBody({ resolution, notes }),
      }, token);
      setNotice("Dispute resolution recorded.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not resolve the dispute.");
    } finally {
      setBusy(false);
    }
  };

  const markNotificationRead = async (notificationId: number) => {
    if (!token) return;
    try {
      await api(`/notifications/${notificationId}/read`, { method: "POST" }, token);
      setNotifications((current) => current.map((notification) => notification.id === notificationId
        ? { ...notification, read_at: new Date().toISOString() }
        : notification));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update the notification.");
    }
  };

  const markAllNotificationsRead = async () => {
    if (!token) return;
    try {
      await api("/notifications/read-all", { method: "POST" }, token);
      setNotifications((current) => current.map((notification) => ({
        ...notification,
        read_at: notification.read_at || new Date().toISOString(),
      })));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update notifications.");
    }
  };

  if (authLoading) {
    return <div className="full-page-loading" role="status">Restoring your secure session?</div>;
  }

  if (!user) {
    return (
      <Landing
        showAuth={showAuth}
        setShowAuth={setShowAuth}
        authMode={authMode}
        setAuthMode={setAuthMode}
        role={role}
        setRole={setRole}
        handleAuth={handleAuth}
        busy={busy}
        categories={categories}
        listings={listings}
        loading={publicDataLoading}
        error={error}
        setError={setError}
      />
    );
  }

  const activeView = view;
  const navItems: Array<{ id: View; label: string; icon: string }> = [
    { id: "overview", label: "Overview", icon: "⌂" },
    { id: "supply", label: "Browse supply", icon: "◉" },
    ...(user.role === "supplier" ? [{ id: "listings" as View, label: "My listings", icon: "▤" }] : []),
    ...(user.role === "buyer" ? [{ id: "requirements" as View, label: "Requirements", icon: "⌕" }] : []),
    { id: "matches", label: "Matches", icon: "⇄" },
    { id: "transactions", label: "Transactions", icon: "↗" },
    ...(user.role === "admin" ? [{ id: "admin" as View, label: "Verification", icon: "✓" }] : []),
    { id: "notifications", label: "Notifications", icon: "N" },
    { id: "disputes", label: "Disputes", icon: "!" },
  ];

  const pageTitle: Record<View, string> = {
    overview: "Your marketplace",
    supply: "Available supply",
    listings: "Your material listings",
    requirements: "Procurement requirements",
    matches: "Aggregated matches",
    transactions: "Transaction history",
    notifications: "Notifications",
    disputes: "Disputes",
    admin: "Marketplace operations",
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={() => setView("overview")}>
          <span className="brand-mark">R</span>
          <span>re-watt<span className="brand-period">.</span></span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav">
          {navItems.map((item) => (
            <button
              className={`nav-item ${activeView === item.id ? "selected" : ""}`}
              key={item.id}
              onClick={() => setView(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>{item.label}
              {item.id === "matches" && matches.length > 0 && (
                <span className="nav-count">{matches.length}</span>
              )}
              {item.id === "notifications" && notifications.some((notification) => !notification.read_at) && (
                <span className="nav-count">{notifications.filter((notification) => !notification.read_at).length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="note-icon">✳</span>
            <strong>Small supplies.<br />One market.</strong>
            <p>Make useful materials easier to find, buy, and track.</p>
          </div>
          <div className="user-mini">
            <div className="avatar">{user.full_name.slice(0, 1).toUpperCase()}</div>
            <div className="user-mini-copy">
              <strong>{user.full_name}</strong>
              <span>{user.role}</span>
            </div>
            <button className="icon-button logout-icon" onClick={logout} title="Sign out" aria-label="Sign out">↗</button>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs">Workspace <span>/</span> {pageTitle[activeView]}</div>
          <div className="topbar-right">
            <span className={`status-pill ${user.is_verified || user.role === "admin" ? "verified" : "pending"}`}>
              <span className="status-dot" />{user.role === "admin" ? "Admin access" : user.status === "rejected" ? "Verification rejected" : user.is_verified ? "Verified" : "Verification pending"}
            </span>
            <button className="icon-button" onClick={logout} title="Sign out" aria-label="Sign out">↗</button>
          </div>
        </header>
        <section className="page-content">
          {workspaceLoading && <div className="workspace-loading" role="status">Refreshing marketplace data...</div>}
          {error && <div className="alert error-alert"><span>!</span>{error}<button onClick={() => setError("")}>×</button></div>}
          {notice && <div className="alert success-alert"><span>✓</span>{notice}<button onClick={() => setNotice("")}>×</button></div>}
          {activeView === "overview" && (
            <Overview
              user={user}
              listings={listings}
              requirements={requirements}
              matches={matches}
              transactions={transactions}
              setView={setView}
              newListing={() => setView("listings")}
            />
          )}
          {activeView === "supply" && <Supply listings={listings} user={user} />}
          {activeView === "listings" && (
            <ListingsPage
              user={user}
              listings={listings.filter((listing) => listing.supplier_id === user.id)}
              materials={materials}
              busy={busy}
              onSubmit={createListing}
            />
          )}
          {activeView === "requirements" && (
            <RequirementsPage
              user={user}
              requirements={requirements}
              materials={materials}
              busy={busy}
              onSubmit={createRequirement}
            />
          )}
          {activeView === "matches" && (
            <MatchesPage user={user} matches={matches} busy={busy} respond={respondToMatch} />
          )}
          {activeView === "transactions" && (
            <TransactionsPage
              user={user}
              transactions={transactions}
              busy={busy}
              handover={handover}
              confirmReceipt={confirmReceipt}
              recordPayment={recordPayment}
              confirmPayment={confirmPayment}
              openDispute={openDispute}
            />
          )}
          {activeView === "notifications" && (
            <NotificationsPage
              notifications={notifications}
              markRead={markNotificationRead}
              markAllRead={markAllNotificationsRead}
              openLink={(link) => setView(link?.startsWith("/app/") ? viewFromPath(link) : "overview")}
            />
          )}
          {activeView === "disputes" && (
            <DisputesPage user={user} disputes={disputes} busy={busy} sendMessage={sendDisputeMessage} resolve={resolveDispute} />
          )}
          {activeView === "admin" && (
            <AdminPage users={pendingUsers} busy={busy} review={reviewAccount} listings={listings} matches={matches} transactions={transactions} disputes={disputes} />
          )}
        </section>
      </main>
    </div>
  );
}

function Landing(props: {
  showAuth: boolean;
  setShowAuth: (value: boolean) => void;
  authMode: "login" | "register";
  setAuthMode: (value: "login" | "register") => void;
  role: "supplier" | "buyer";
  setRole: (value: "supplier" | "buyer") => void;
  handleAuth: (event: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
  categories: Category[];
  listings: Listing[];
  loading: boolean;
  error: string;
  setError: (value: string) => void;
}) {
  return (
    <div className="landing">
      <header className="landing-nav">
        <a className="brand" href="#">
          <span className="brand-mark">R</span>
          <span>re-watt<span className="brand-period">.</span></span>
        </a>
        <nav className="landing-links">
          <a href="#how-it-works">How it works</a>
          <a href="#marketplace">Marketplace</a>
          <button className="button button-outline button-small" onClick={() => { props.setAuthMode("login"); props.setShowAuth(true); }}>
            Log in
          </button>
          <button className="button button-dark button-small" onClick={() => { props.setAuthMode("register"); props.setShowAuth(true); }}>
            Join the marketplace <span>↗</span>
          </button>
        </nav>
      </header>

      {props.error && <div className="landing-error">{props.error}<button onClick={() => props.setError("")}>×</button></div>}

      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="live-dot" /> KENYA'S MATERIAL MARKETPLACE</div>
          <h1>Small supplies.<br />One <em>market.</em></h1>
          <p className="hero-description">
            We bring fragmented material supply together, so useful resources reach the businesses that need them.
          </p>
          <div className="hero-actions">
            <button className="button button-dark button-large" onClick={() => { props.setRole("supplier"); props.setAuthMode("register"); props.setShowAuth(true); }}>
              I have materials <span>↗</span>
            </button>
            <button className="button button-outline button-large" onClick={() => { props.setRole("buyer"); props.setAuthMode("register"); props.setShowAuth(true); }}>
              I need materials <span>↗</span>
            </button>
          </div>
          <div className="hero-trust">
            <div className="trust-avatars"><i>W</i><i>K</i><i>M</i></div>
            <span>Connecting local supply to real demand</span>
          </div>
        </div>
        <div className="hero-art" aria-label="Illustration of material supply being aggregated">
          <div className="art-orbit orbit-one" />
          <div className="art-orbit orbit-two" />
          <div className="orbit-label label-top">SAMPLE SUPPLY <span>↘</span></div>
          <div className="supply-card supply-one"><span className="supply-icon">♧</span><span><b>Kiambu County</b><small>400 kg · Maize cobs</small></span><strong>+400</strong></div>
          <div className="supply-card supply-two"><span className="supply-icon icon-coral">♧</span><span><b>Murang'a County</b><small>400 kg · Maize cobs</small></span><strong>+400</strong></div>
          <div className="aggregate-core"><span className="core-spark">✳</span><b>2,000</b><small>KG AGGREGATED</small><span className="core-sub">SAMPLE FLOW</span></div>
          <div className="supply-card supply-three"><span className="supply-icon icon-gold">♧</span><span><b>Nyeri County</b><small>400 kg · Maize cobs</small></span><strong>+400</strong></div>
          <div className="orbit-label label-bottom">SAMPLE REQUIREMENT <span>↗</span></div>
          <div className="art-decoration leaf-shape">✳</div>
        </div>
      </section>

      <section className="proof-strip">
        <div><strong>2,000 kg</strong><span>One buyer requirement</span></div>
        <div><strong>5 suppliers</strong><span>Small lots, brought together</span></div>
        <div><strong>One workflow</strong><span>Discover. Match. Track.</span></div>
        <div className="proof-mark">RE-WATT <span>MARKETPLACE</span></div>
      </section>

      <section className="golden-demo" aria-labelledby="golden-demo-title">
        <div className="golden-demo-heading"><div><div className="section-kicker">ILLUSTRATIVE GOLDEN DEMO - NOT LIVE INVENTORY</div><h2 id="golden-demo-title">Five small lots. One buyer's 2,000 kg need.</h2><p>This fixed example shows the marketplace value proposition. Live matches and totals are always supplied by the backend.</p></div><span className="demo-total"><strong>2,000 kg</strong><small>buyer requirement</small></span></div>
        <div className="demo-suppliers">
          {[
            ["Wanjiku Farm", "Kiambu"],
            ["Mugo Growers", "Murang'a"],
            ["Njoroge Co-op", "Nyeri"],
            ["Kariuki Fields", "Nakuru"],
            ["Achieng Harvest", "Uasin Gishu"],
          ].map(([name, county], index) => <article className="demo-supplier" key={name}><span className="demo-supplier-index">0{index + 1}</span><div><strong>{name}</strong><small>{county} County - maize cobs</small></div><b>400 kg</b></article>)}
        </div>
        <div className="demo-caption">Sample scenario only - it does not create listings, calculate a match, or reserve real supply.</div>
      </section>

      <section className="how-section" id="how-it-works">
        <div className="section-kicker">A BETTER WAY TO SOURCE</div>
        <div className="section-heading">
          <h2>Supply is here.<br /><em>It's just scattered.</em></h2>
          <p>One supplier's surplus is another business's feedstock. Re-Watt makes the connection simple, transparent, and trusted.</p>
        </div>
        <div className="steps">
          {[
            ["01", "List what you have", "Suppliers share material, quantity, condition, and location."],
            ["02", "Bring supply together", "Buyers find compatible supply across multiple local listings."],
            ["03", "Trade with clarity", "Both sides confirm quantities and keep a transaction record."],
          ].map(([number, title, detail]) => (
            <article className="step-card" key={number}>
              <span className="step-number">{number}</span><span className="step-arrow">↗</span>
              <h3>{title}</h3><p>{detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="market-preview" id="marketplace">
        <div className="preview-copy">
          <div className="section-kicker">STARTING WITH BIOMASS</div>
          <h2>Good materials<br />deserve <em>better use.</em></h2>
          <p>We’re starting with agricultural residues like maize cobs and connecting them to processors creating briquettes, pellets, and biomass fuel.</p>
          <button className="button button-dark" onClick={() => { props.setAuthMode("register"); props.setShowAuth(true); }}>
            Explore the marketplace <span>↗</span>
          </button>
        </div>
        <div className="preview-board">
          <div className="preview-topline"><span>LIVE MARKETPLACE</span><span className="market-state"><i /> OPEN FOR PILOT</span></div>
          {props.listings.length ? (
            props.listings.slice(0, 3).map((listing) => (
              <div className="preview-listing" key={listing.id}>
                <div className="material-thumb">♧</div>
                <div className="preview-listing-name"><b>{listing.material}</b><span>{listing.county || "Kenya"} · {listing.condition}</span></div>
                <strong>{listing.quantity_available.toLocaleString()} <small>{listing.unit}</small></strong>
              </div>
            ))
          ) : (
            <div className="empty-preview">
              <span className="empty-leaf">♧</span>
              <strong>{props.categories.flatMap((item) => item.materials).length} material types ready</strong>
              <p>Verified supply will appear here as suppliers join the pilot.</p>
            </div>
          )}
          <div className="preview-footer"><span>✓ Verification-led marketplace</span><span>● {props.listings.length} active listings</span></div>
        </div>
      </section>

      <footer className="landing-footer">
        <a className="brand" href="#"><span className="brand-mark">R</span><span>re-watt<span className="brand-period">.</span></span></a>
        <span>Turning scattered supply into shared opportunity.</span><span>© 2026 Re-Watt Energy</span>
      </footer>

      {props.showAuth && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) props.setShowAuth(false); }}>
          <section className="auth-modal">
            <button className="modal-close" onClick={() => props.setShowAuth(false)} aria-label="Close">×</button>
            <div className="eyebrow"><span className="live-dot" /> RE-WATT MARKETPLACE</div>
            <h2>{props.authMode === "login" ? "Welcome back." : "Join the movement."}</h2>
            <p className="modal-subtitle">{props.authMode === "login" ? "Sign in to continue to your workspace." : "Create an account to connect with local material markets."}</p>
            {props.authMode === "register" && (
              <div className="role-select">
                <button className={props.role === "supplier" ? "active" : ""} onClick={() => props.setRole("supplier")} type="button">I have materials</button>
                <button className={props.role === "buyer" ? "active" : ""} onClick={() => props.setRole("buyer")} type="button">I need materials</button>
              </div>
            )}
            <form className="form-stack" onSubmit={props.handleAuth}>
              {props.authMode === "register" && (
                <>
                  <label>Full name<input name="full_name" required minLength={2} placeholder="Your name" autoComplete="name" /></label>
                  <label>{props.role === "supplier" ? "Farm or business name" : "Business name"}<input name="business_name" required minLength={2} placeholder="Organisation name" /></label>
                  <div className="form-row">
                    <label>County<input name="county" placeholder="e.g. Kiambu" /></label>
                    <label>Phone<input name="phone" type="tel" placeholder="+254…" autoComplete="tel" /></label>
                  </div>
                  {props.role === "supplier" ? (
                    <label>Supplier type<select name="supplier_type" required defaultValue="farmer"><option value="farmer">Farmer</option><option value="small_producer">Small producer</option><option value="business">Business</option></select></label>
                  ) : (
                    <label>Business type<select name="business_type" defaultValue="biomass_processor"><option value="biomass_processor">Biomass processor</option><option value="manufacturer">Manufacturer</option><option value="recycler">Recycler</option><option value="other">Other</option></select></label>
                  )}
                </>
              )}
              <label>Email address<input name="email" type="email" required placeholder="you@business.com" autoComplete="email" /></label>
              <label>Password<input name="password" type="password" minLength={8} maxLength={72} required placeholder="At least 8 characters" autoComplete={props.authMode === "login" ? "current-password" : "new-password"} /></label>
              <button className="button button-dark button-full" disabled={props.busy}>
                {props.busy ? "Please wait…" : props.authMode === "login" ? "Log in" : "Create account"} <span>↗</span>
              </button>
            </form>
            <div className="auth-switch">
              {props.authMode === "login" ? "New to Re-Watt?" : "Already have an account?"}
              <button onClick={() => props.setAuthMode(props.authMode === "login" ? "register" : "login")}>
                {props.authMode === "login" ? "Create account" : "Log in"}
              </button>
            </div>
            <p className="auth-footnote">Accounts are reviewed by our team before marketplace activity is enabled.</p>
          </section>
        </div>
      )}
    </div>
  );
}

function PageHeading(props: { eyebrow: string; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="page-heading">
      <div><div className="section-kicker">{props.eyebrow}</div><h1>{props.title}</h1>{props.description && <p>{props.description}</p>}</div>
      {props.action}
    </div>
  );
}

function Overview(props: {
  user: User;
  listings: Listing[];
  requirements: Requirement[];
  matches: Match[];
  transactions: Transaction[];
  setView: (view: View) => void;
  newListing: () => void;
}) {
  const isSupplier = props.user.role === "supplier";
  const isBuyer = props.user.role === "buyer";
  const userListings = props.listings.filter((listing) => listing.supplier_id === props.user.id);
  const completed = props.transactions.filter((transaction) => transaction.status === "completed").length;
  return (
    <>
      <PageHeading
        eyebrow={`GOOD TO SEE YOU, ${props.user.full_name.split(" ")[0].toUpperCase()}`}
        title={isSupplier ? "Your supply, in good company." : isBuyer ? "Let’s find what you need." : "Marketplace at a glance."}
        description={isSupplier ? "Bring your materials to the businesses looking for them." : isBuyer ? "Discover verified supply, brought together for your next order." : "Review new businesses and keep the marketplace trusted."}
        action={isSupplier ? <button className="button button-dark" onClick={props.newListing}>+ List material</button> : isBuyer ? <button className="button button-dark" onClick={() => props.setView("requirements")}>+ Post requirement</button> : null}
      />
      {!props.user.is_verified && props.user.role !== "admin" && (
        <div className="verification-banner"><span className="verification-symbol">◷</span><div><strong>{props.user.status === "rejected" ? "Your verification needs follow-up" : "Your account is under review"}</strong><p>{props.user.status === "rejected" ? "Contact the platform team for next steps before using marketplace actions." : "Our team checks business details before you can publish materials or request a match."}</p></div><span className="pending-tag">{props.user.status === "rejected" ? "REJECTED" : "IN REVIEW"}</span></div>
      )}
      <div className="metric-grid">
        <Metric label={isSupplier ? "Active listings" : "Available listings"} value={isSupplier ? userListings.length : props.listings.length} note="Live on the marketplace" icon="▤" />
        <Metric label={isBuyer ? "Open requirements" : "Your matches"} value={isBuyer ? props.requirements.filter((item) => item.status !== "completed").length : props.matches.length} note="Across your workspace" icon="⇄" />
        <Metric label="Transactions" value={props.transactions.length} note={`${completed} completed`} icon="↗" />
        <Metric label="Trust status" value={props.user.is_verified ? "Verified" : "Pending"} note="Admin reviewed business" icon="✓" positive={props.user.is_verified} />
      </div>
      <div className="dashboard-grid">
        <section className="panel main-panel">
          <div className="panel-head"><div><span className="panel-kicker">MARKET ACTIVITY</span><h2>{isSupplier ? "Your latest listings" : "Available material"}</h2></div><button className="text-button" onClick={() => props.setView(isSupplier ? "listings" : "supply")}>View all ↗</button></div>
          {(isSupplier ? userListings : props.listings).slice(0, 4).map((listing) => (
            <div className="listing-row" key={listing.id}>
              <div className="material-thumb small-thumb">♧</div>
              <div className="row-main"><strong>{listing.material}</strong><span>{listing.county || "Kenya"} · {listing.condition}</span></div>
              <div className="row-quantity"><strong>{listing.quantity_available.toLocaleString()} {listing.unit}</strong><span>available</span></div>
              <span className="table-status active-status">Active</span>
            </div>
          ))}
          {(isSupplier ? userListings : props.listings).length === 0 && <EmptyState title="Nothing listed yet" text={isSupplier ? "Add your first material listing once your account is verified." : "New verified listings will appear here."} />}
        </section>
        <section className="panel activity-panel">
          <div className="panel-head"><div><span className="panel-kicker">YOUR WORKFLOW</span><h2>Next steps</h2></div><span className="panel-icon">✳</span></div>
          <div className="workflow-list">
            {(isSupplier
              ? [["01", "Get verified", props.user.is_verified ? "Business approved" : "Our team is reviewing your details", props.user.is_verified],
                ["02", "List your supply", userListings.length ? `${userListings.length} active listing(s)` : "Share your first material", userListings.length > 0],
                ["03", "Respond to matches", `${props.matches.length} match request(s)`, props.matches.length > 0]]
              : [["01", "Complete verification", props.user.is_verified ? "Business approved" : "Account is under review", props.user.is_verified],
                ["02", "Post a requirement", `${props.requirements.length} requirement(s) created`, props.requirements.length > 0],
                ["03", "Review aggregated supply", `${props.matches.length} match result(s)`, props.matches.length > 0]]
            ).map(([number, title, text, done]) => (
              <div className="workflow-item" key={number as string}><span className={`workflow-number ${done ? "done" : ""}`}>{done ? "✓" : number}</span><div><strong>{title as string}</strong><span>{text as string}</span></div><span className="workflow-arrow">›</span></div>
            ))}
          </div>
          <div className="impact-note"><span>↗</span><p>Good material, found faster.<br /><strong>That’s a better kind of growth.</strong></p></div>
        </section>
      </div>
      <section className="bottom-cta"><div className="cta-leaf">♧</div><div><span className="panel-kicker">READY WHEN YOU ARE</span><strong>{isSupplier ? "Have a new batch to share?" : "Looking for your next supply?"}</strong><p>{isSupplier ? "Add quantity and location. We’ll make it easier for buyers to find." : "Tell us what you need and we’ll find the matching supply."}</p></div><button className="button button-dark" onClick={() => props.setView(isSupplier ? "listings" : "requirements")}>{isSupplier ? "List material" : "Post requirement"} <span>↗</span></button></section>
    </>
  );
}

function Metric(props: { label: string; value: string | number; note: string; icon: string; positive?: boolean }) {
  return <div className="metric-card"><div className="metric-top"><span>{props.label}</span><span className="metric-icon">{props.icon}</span></div><strong className={`metric-value ${props.positive ? "metric-positive" : ""}`}>{props.value}</strong><span className="metric-note">{props.note}</span></div>;
}

function Supply({ listings, user }: { listings: Listing[]; user: User }) {
  return <>
    <PageHeading eyebrow="THE OPEN MARKET" title="Available supply" description="Browse active material listings from across the marketplace." />
    <div className="market-summary"><span className="market-summary-icon">✳</span><div><strong>Scattered supply, brought into view.</strong><p>Check the condition, location, and available amount before requesting a match.</p></div><span className="summary-count">{listings.length} listings</span></div>
    <div className="supply-grid">
      {listings.map((listing) => <article className="supply-tile" key={listing.id}>
        <div className="tile-top"><div className="material-thumb">♧</div><span className="table-status active-status">Available</span></div>
        <div className="section-kicker">{listing.county || "KENYA"}{listing.city ? ` · ${listing.city.toUpperCase()}` : ""}</div>
        <h3>{listing.material}</h3><p className="tile-title">{listing.title}</p>
        <div className="tile-quantity"><strong>{listing.quantity_available.toLocaleString()}</strong><span>{listing.unit} available</span></div>
        <div className="tile-meta"><span>Condition</span><strong>{listing.condition}</strong></div>
        <div className="tile-meta"><span>Listed by</span><strong>{listing.supplier_name}{listing.supplier_id === user.id ? " · you" : ""}</strong></div>
        <div className="tile-meta"><span>Indicative price</span><strong>{listing.price_per_unit == null ? "Ask supplier" : `${listing.currency} ${listing.price_per_unit.toLocaleString()} / ${listing.unit}`}</strong></div>
      </article>)}
    </div>
    {listings.length === 0 && <EmptyState title="The marketplace is getting ready" text="No active supply is available yet. Verified supplier listings will show here." />}
  </>;
}

function ListingsPage(props: { user: User; listings: Listing[]; materials: ReturnType<typeof flattenMaterials>; busy: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const [selectedMaterialId, setSelectedMaterialId] = useState<number | null>(props.materials[0]?.id ?? null);
  const selectedMaterial = props.materials.find((material) => material.id === selectedMaterialId) ?? props.materials[0];
  return <>
    <PageHeading eyebrow="SUPPLIER WORKSPACE" title="Your material listings" description="Turn your available materials into supply buyers can discover." />
    {!props.user.is_verified ? <div className="verification-banner"><span className="verification-symbol">◷</span><div><strong>Verification required before publishing</strong><p>We’ll activate listing tools after an admin has verified your supplier account.</p></div><span className="pending-tag">PENDING</span></div> : (
      <section className="panel form-panel"><div className="panel-head"><div><span className="panel-kicker">ADD TO THE MARKET</span><h2>List available material</h2></div></div>
        <form className="market-form" onSubmit={props.onSubmit}>
          <label>Material<select name="material_id" required value={selectedMaterial?.id ?? ""} onChange={(event) => setSelectedMaterialId(Number(event.target.value))}>{props.materials.map((material) => <option value={material.id} key={material.id}>{material.name}</option>)}</select></label>
          {selectedMaterial && <aside className="material-insight"><strong>Material profile ? catalog guidance</strong><p>{selectedMaterial.description || "Reference material information from the Re-Watt catalog."}</p><span>Typical conditions: {selectedMaterial.typical_conditions.join(", ") || "Discuss with buyer"}</span><span>Potential uses: {selectedMaterial.primary_uses.join(", ") || "Discuss with buyer"}</span><small>Reference information only; it does not certify stock quality or replace buyer inspection.</small></aside>}
          <label>Listing title<input name="title" required minLength={3} placeholder="e.g. Dry maize cobs from this harvest" /></label>
          <div className="form-row"><label>Quantity<input name="quantity" type="number" required min="0.01" step="0.01" placeholder="500" /></label><label>Unit<select name="unit" defaultValue="kg"><option value="kg">Kilograms (kg)</option><option value="tonne">Tonnes</option><option value="bag">Bags</option></select></label><label>Condition<select name="condition">{conditions.map((condition) => <option key={condition} value={condition}>{condition}</option>)}</select></label></div>
          <div className="form-row"><label>County<input name="county" placeholder="e.g. Kiambu" /></label><label>Town<input name="city" placeholder="e.g. Thika" /></label><label>Available from<input name="available_from" type="date" /></label></div>
          <div className="form-row"><label>Indicative price (KES / unit)<input name="price_per_unit" type="number" min="0" step="0.01" placeholder="Optional" /></label><label>Notes<textarea name="description" rows={2} placeholder="Share details buyers should know" /></label></div>
          <div className="form-actions"><span>Quantity and condition are confirmed by the buyer at handover.</span><button className="button button-dark" disabled={props.busy}>{props.busy ? "Publishing…" : "Publish listing"} <span>↗</span></button></div>
        </form>
      </section>
    )}
    <section className="panel table-panel"><div className="panel-head"><div><span className="panel-kicker">YOUR CATALOGUE</span><h2>Active listings <span className="heading-count">{props.listings.length}</span></h2></div></div>
      {props.listings.map((listing) => <div className="listing-row" key={listing.id}><div className="material-thumb small-thumb">♧</div><div className="row-main"><strong>{listing.material}</strong><span>{listing.county || "Kenya"} · {listing.condition}</span></div><div className="row-quantity"><strong>{listing.quantity_available.toLocaleString()} {listing.unit}</strong><span>available</span></div><span className="table-status active-status">{listing.status.replaceAll("_", " ")}</span></div>)}
      {props.listings.length === 0 && <EmptyState title="No listings yet" text={props.user.is_verified ? "Publish your first material above." : "Your listings will appear here once your account is verified."} />}
    </section>
  </>;
}

type MaterialItem = { id: number; name: string; description?: string | null; typical_conditions: string[]; primary_uses: string[] };
function flattenMaterials(categories: Category[]): MaterialItem[] {
  return categories.flatMap((category) => category.materials);
}

function RequirementsPage(props: { user: User; requirements: Requirement[]; materials: MaterialItem[]; busy: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <>
    <PageHeading eyebrow="BUYER WORKSPACE" title="Tell the market what you need" description="Post a requirement and we’ll aggregate compatible active listings." />
    {!props.user.is_verified && <div className="verification-banner"><span className="verification-symbol">&#x23F3;</span><div><strong>Verification required before posting</strong><p>Our team must verify your buyer account before you can create requirements or request supply.</p></div><span className="pending-tag">PENDING</span></div>}
    {props.user.is_verified && <section className="panel form-panel"><div className="panel-head"><div><span className="panel-kicker">CREATE A REQUIREMENT</span><h2>What are you sourcing?</h2></div><span className="panel-icon">⌕</span></div>
      <form className="market-form" onSubmit={props.onSubmit}>
        <label>Material<select name="material_id" required>{props.materials.map((material) => <option value={material.id} key={material.id}>{material.name}</option>)}</select></label>
        <label>Requirement title<input name="title" required minLength={3} placeholder="e.g. Dry maize cobs for briquette production" /></label>
        <div className="form-row"><label>Quantity needed<input name="quantity" type="number" required min="0.01" step="0.01" placeholder="2000" /></label><label>Unit<select name="unit" defaultValue="kg"><option value="kg">Kilograms (kg)</option><option value="tonne">Tonnes</option><option value="bag">Bags</option></select></label><label>Needed by<input name="required_by" type="date" /></label></div>
        <label>Delivery counties <span className="field-help">Separate multiple counties with commas</span><input name="delivery_counties" placeholder="Kiambu, Murang'a, Nyeri" /></label>
        <div className="field-group"><span className="field-title">Acceptable conditions <span className="field-help">No selection means all conditions</span></span><div className="condition-options">{conditions.map((condition) => <label key={condition} className="checkbox-pill"><input type="checkbox" name="conditions" value={condition} />{condition}</label>)}</div></div>
        <div className="form-row"><label>Target price (KES / unit)<input name="target_price_per_unit" type="number" min="0" step="0.01" placeholder="Optional" /></label><label>Intended use<input name="intended_use" placeholder="e.g. Biomass briquettes" /></label></div>
        <div className="form-actions"><span>Matching uses material, quantity, condition, location, and price filters.</span><button className="button button-dark" disabled={props.busy}>{props.busy ? "Finding supply…" : "Post & find supply"} <span>↗</span></button></div>
      </form>
    </section>}
    <section className="panel table-panel"><div className="panel-head"><div><span className="panel-kicker">YOUR BUYER DESK</span><h2>Open requirements <span className="heading-count">{props.requirements.length}</span></h2></div></div>
      {props.requirements.map((item) => <div className="listing-row" key={item.id}><div className="material-thumb small-thumb">⌕</div><div className="row-main"><strong>{item.material}</strong><span>{item.title}</span></div><div className="row-quantity"><strong>{item.quantity.toLocaleString()} {item.unit}</strong><span>requested</span></div><span className={`table-status ${item.status === "open" ? "active-status" : "pending-status"}`}>{item.status.replaceAll("_", " ")}</span></div>)}
      {props.requirements.length === 0 && <EmptyState title="No requirements posted" text="Create a requirement above to see aggregated supply results." />}
    </section>
  </>;
}

function MatchesPage(props: { user: User; matches: Match[]; busy: boolean; respond: (id: number, accept: boolean) => void }) {
  return <>
    <PageHeading eyebrow="THE AGGREGATION ENGINE" title="One need. Many suppliers." description="Compatible supply is grouped into a single clear offer. Suppliers still decide whether to take part." />
    {props.matches.map((match) => (
      <section className="match-card panel" key={match.id}>
        <div className="match-heading"><div><span className="panel-kicker">MATCH #{String(match.id).padStart(4, "0")}</span><h2>{match.supplier_count} supplier{match.supplier_count === 1 ? "" : "s"} found</h2></div><span className={`table-status ${match.status === "confirmed" ? "active-status" : "pending-status"}`}>{match.status.replaceAll("_", " ")}</span></div>
        <div className="match-coverage"><div className="coverage-label"><span>Supply coverage</span><strong>{match.coverage_percent.toFixed(0)}%</strong></div><div className="coverage-track"><span style={{ width: `${Math.min(match.coverage_percent, 100)}%` }} /></div><small>{match.matched_quantity.toLocaleString()} of {match.requested_quantity.toLocaleString()} {match.unit} requested</small></div>
        <div className="table-scroll"><table><thead><tr><th>Supplier</th><th>Available material</th><th>Condition</th><th>Location</th><th>Offer</th></tr></thead><tbody>
          {match.items.map((item) => <tr key={item.listing_id}><td><span className="table-person"><i>{item.supplier_name.slice(0, 1)}</i>{item.supplier_name}{item.supplier_id === props.user.id && <small>YOU</small>}</span></td><td>{item.title}</td><td><span className="condition-tag">{item.condition}</span></td><td>{item.county || "—"}</td><td><strong>{Number(item.quantity).toLocaleString()} <small>{item.unit}</small></strong></td></tr>)}
        </tbody></table></div>
        <div className="match-footer"><div className="insight-mark">✳</div><p><strong>Compatibility insight - marketplace rules</strong><span>{match.explanation || "The backend has grouped compatible materials, conditions, and locations. This summary does not make the final transaction decision."}</span></p>
          {props.user.role === "supplier" && match.status === "requested" && match.items.some((item) => item.supplier_id === props.user.id) && <div className="match-actions"><button className="button button-outline" disabled={props.busy} onClick={() => props.respond(match.id, false)}>Decline</button><button className="button button-dark" disabled={props.busy} onClick={() => props.respond(match.id, true)}>Accept invitation <span>↗</span></button></div>}
        </div>
      </section>
    ))}
    {props.matches.length === 0 && <EmptyState title="No matches yet" text={props.user.role === "buyer" ? "Post a requirement to discover aggregated supply." : "When a buyer's requirement matches your listings, their offer will appear here."} />}
  </>;
}

function TransactionsPage(props: {
  user: User;
  transactions: Transaction[];
  busy: boolean;
  handover: (id: number) => void;
  confirmReceipt: (id: number, quantity: number) => void;
  recordPayment: (id: number) => void;
  confirmPayment: (id: number) => void;
  openDispute: (id: number) => void;
}) {
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  return <>
    <PageHeading eyebrow="HANDOVER & HISTORY" title="Transactions, clearly tracked." description="Follow handover and receipt in the marketplace. Payment references are recorded for manual settlement; the platform does not move funds." />
    <div className="payment-note"><span>i</span><p><strong>Payments are recorded, not processed by Re-Watt.</strong> Confirm funds only after they have actually cleared.</p></div>
    {props.transactions.map((transaction) => {
      const canConfirmReceipt = props.user.role === "buyer" && transaction.quantity_received == null && ["in_transit", "delivered"].includes(transaction.status);
      return <section className="transaction-card panel" key={transaction.id}>
        <div className="transaction-top"><div><span className="panel-kicker">TRANSACTION #{String(transaction.id).padStart(5, "0")}</span><h2>{transaction.material}</h2><p>{props.user.role === "buyer" ? `Supplier: ${transaction.supplier_name}` : `Buyer: ${transaction.buyer_name}`}</p></div><span className={`table-status ${transaction.status === "completed" ? "active-status" : "pending-status"}`}>{transaction.status.replaceAll("_", " ")}</span></div>
        <div className="transaction-details"><div><span>Declared amount</span><strong>{transaction.quantity_declared.toLocaleString()} {transaction.unit}</strong></div><div><span>Received amount</span><strong>{transaction.quantity_received == null ? "Awaiting confirmation" : `${transaction.quantity_received.toLocaleString()} ${transaction.unit}`}</strong></div><div><span>Total (incl. platform fee)</span><strong>{transaction.currency} {transaction.total.toLocaleString()}</strong></div></div>
        {props.user.role === "supplier" && transaction.status === "pending_handover" && <div className="transaction-actions"><span className="field-help">When the material leaves you, record the handover for the buyer.</span><button className="button button-dark" disabled={props.busy} onClick={() => props.handover(transaction.id)}>Mark handed over <span>→</span></button></div>}
        {props.user.role === "buyer" && transaction.quantity_received == null && transaction.status === "pending_handover" && <div className="transaction-actions"><span className="field-help">Waiting for the supplier to record handover before receipt can be confirmed.</span></div>}
        {canConfirmReceipt && <div className="transaction-actions"><label>Quantity received ({transaction.unit})<input type="number" min="0.01" step="0.01" value={quantities[transaction.id] || ""} onChange={(event) => setQuantities({ ...quantities, [transaction.id]: event.target.value })} /></label><button className="button button-dark" disabled={props.busy || !quantities[transaction.id]} onClick={() => props.confirmReceipt(transaction.id, Number(quantities[transaction.id]))}>Confirm receipt <span>→</span></button></div>}
        {props.user.role === "buyer" && transaction.status === "payment_pending" && <div className="transaction-actions"><span className="field-help">After paying the supplier directly, record the reference here.</span><button className="button button-dark" disabled={props.busy} onClick={() => props.recordPayment(transaction.id)}>Record payment reference</button></div>}
        {transaction.payments.filter((payment) => payment.status === "pending").map((payment) => (
          <div className="payment-row" key={payment.id}><div><strong>Payment awaiting supplier confirmation</strong><span>{payment.method.replaceAll("_", " ")}{payment.reference ? ` · Ref ${payment.reference}` : ""}</span></div>{props.user.role === "supplier" && transaction.supplier_id === props.user.id && <button className="button button-dark button-small" disabled={props.busy} onClick={() => props.confirmPayment(payment.id)}>Confirm funds received</button>}</div>
        ))}
        {props.user.role !== "admin" && !["disputed", "cancelled"].includes(transaction.status) && <button className="text-button dispute-action" disabled={props.busy} onClick={() => props.openDispute(transaction.id)}>Report a transaction issue</button>}
      </section>;
    })}
    {props.transactions.length === 0 && <EmptyState title="No transactions yet" text="Accepted supplier matches will turn into transaction records here." />}
  </>;
}

function AdminPage(props: {
  users: Array<{ user_id: number; name: string; email: string; role: string; business_name?: string; county?: string }>;
  busy: boolean;
  review: (id: number, decision: "verified" | "rejected") => void;
  listings: Listing[];
  matches: Match[];
  transactions: Transaction[];
  disputes: Dispute[];
}) {
  return <>
    <PageHeading eyebrow="MARKETPLACE OPERATIONS" title="Trust and activity at a glance." description="Review accounts and monitor the listings, aggregated matches, transactions, and disputes recorded by the marketplace." />
    <div className="metric-grid">
      <Metric label="Pending verification" value={props.users.length} note="Supplier and buyer accounts" icon="?" />
      <Metric label="Active supply" value={props.listings.length} note="Available listings" icon="?" />
      <Metric label="Matches" value={props.matches.length} note="Backend-generated offers" icon="?" />
      <Metric label="Open disputes" value={props.disputes.filter((dispute) => !["resolved", "closed"].includes(dispute.status)).length} note={`${props.transactions.length} transactions recorded`} icon="!" />
    </div>
    <section className="panel table-panel"><div className="panel-head"><div><span className="panel-kicker">NEEDS YOUR REVIEW</span><h2>Pending business accounts <span className="heading-count">{props.users.length}</span></h2></div></div>
      {props.users.map((account) => <div className="admin-user-row" key={account.user_id}><div className="avatar">{account.name.slice(0, 1)}</div><div className="row-main"><strong>{account.business_name || account.name}</strong><span>{account.name} ? {account.email} ? {account.county || "County not provided"}</span></div><span className="role-tag">{account.role}</span><div className="admin-actions"><button className="button button-outline button-small" disabled={props.busy} onClick={() => props.review(account.user_id, "rejected")}>Reject</button><button className="button button-dark button-small" disabled={props.busy} onClick={() => props.review(account.user_id, "verified")}>Verify</button></div></div>)}
      {props.users.length === 0 && <EmptyState title="All caught up" text="No accounts are waiting for verification." />}
    </section>
    <div className="admin-disclaimer">Marketplace counts and statuses are read from the API. Matching and aggregation remain backend decisions; physical stock is confirmed at handover.</div>
  </>;
}

function NotificationsPage(props: {
  notifications: Notification[];
  markRead: (id: number) => void;
  markAllRead: () => void;
  openLink: (link: string | null) => void;
}) {
  const unreadCount = props.notifications.filter((notification) => !notification.read_at).length;
  return <>
    <PageHeading eyebrow="ACTIVITY UPDATES" title="Keep up with your marketplace." description="Verification, match, transaction, payment, and dispute updates are saved to your account." action={unreadCount > 0 ? <button className="button button-outline" onClick={props.markAllRead}>Mark all read</button> : undefined} />
    <section className="panel notification-list">
      {props.notifications.map((notification) => <article className={`notification-row ${notification.read_at ? "read" : "unread"}`} key={notification.id}>
        <span className="notification-icon">{notification.read_at ? "?" : "?"}</span>
        <div className="notification-copy"><div><strong>{notification.title}</strong><span className="role-tag">{notification.type.replaceAll("_", " ")}</span></div><p>{notification.body}</p><time>{new Date(notification.created_at).toLocaleString()}</time></div>
        {notification.link && <button className="text-button" onClick={() => { props.markRead(notification.id); props.openLink(notification.link); }}>Open ?</button>}
        {!notification.read_at && <button className="button button-outline button-small" onClick={() => props.markRead(notification.id)}>Mark read</button>}
      </article>)}
      {props.notifications.length === 0 && <EmptyState title="No updates yet" text="Account reviews and marketplace workflow changes will appear here." />}
    </section>
  </>;
}

function DisputesPage(props: {
  user: User;
  disputes: Dispute[];
  busy: boolean;
  sendMessage: (id: number, body: string) => void;
  resolve: (id: number, resolution: string, notes: string) => void;
}) {
  return <>
    <PageHeading eyebrow="TRANSACTION SUPPORT" title="Disputes, with a clear record." description="Parties can add context to an open issue. An admin records the resolution; AI does not decide disputes." />
    {props.disputes.map((dispute) => <DisputeCard key={dispute.id} dispute={dispute} user={props.user} busy={props.busy} sendMessage={props.sendMessage} resolve={props.resolve} />)}
    {props.disputes.length === 0 && <EmptyState title="No disputes on your account" text="If a transaction needs review, open a dispute from its transaction card. Admins can see and respond to all open cases." />}
  </>;
}

function DisputeCard(props: {
  dispute: Dispute;
  user: User;
  busy: boolean;
  sendMessage: (id: number, body: string) => void;
  resolve: (id: number, resolution: string, notes: string) => void;
}) {
  const [resolution, setResolution] = useState("split");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const isOpen = !["resolved", "closed"].includes(props.dispute.status);
  const submitMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!message.trim()) return;
    props.sendMessage(props.dispute.id, message.trim());
    setMessage("");
  };
  return <section className="panel dispute-card">
    <div className="transaction-top"><div><span className="panel-kicker">DISPUTE #{props.dispute.id} ? TRANSACTION #{props.dispute.transaction_id}</span><h2>{props.dispute.material}</h2><p>{props.dispute.supplier_name} ? {props.dispute.buyer_name}</p></div><span className={`table-status ${isOpen ? "pending-status" : "active-status"}`}>{props.dispute.status.replaceAll("_", " ")}</span></div>
    <div className="dispute-reason"><strong>Issue reported</strong><p>{props.dispute.reason}</p></div>
    {props.dispute.messages.map((item) => <div className="dispute-message" key={item.id}><strong>{item.author_name}</strong><p>{item.body}</p><time>{new Date(item.created_at).toLocaleString()}</time></div>)}
    {isOpen && <form className="dispute-reply" onSubmit={submitMessage}><label htmlFor={`message-${props.dispute.id}`}>Add an update</label><textarea id={`message-${props.dispute.id}`} value={message} onChange={(event) => setMessage(event.target.value)} rows={2} maxLength={4000} required /><button className="button button-outline button-small" disabled={props.busy || !message.trim()}>Send update</button></form>}
    {!isOpen && <div className="dispute-resolution"><strong>Resolution: {props.dispute.resolution.replaceAll("_", " ")}</strong><p>{props.dispute.resolution_notes || "No resolution note was provided."}</p></div>}
    {props.user.role === "admin" && isOpen && <div className="dispute-admin-controls"><label>Resolution<select value={resolution} onChange={(event) => setResolution(event.target.value)}><option value="full_buyer">In buyer's favour</option><option value="full_supplier">In supplier's favour</option><option value="split">Shared resolution</option><option value="withdrawn">Withdrawn</option></select></label><label>Admin notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} maxLength={2000} required /></label><button className="button button-dark button-small" disabled={props.busy || !notes.trim()} onClick={() => props.resolve(props.dispute.id, resolution, notes.trim())}>Record resolution</button></div>}
  </section>;
}


function EmptyState(props: { title: string; text: string }) {
  return <div className="empty-state"><span>i</span><strong>{props.title}</strong><p>{props.text}</p></div>;
}

export default App;
