import { useEffect, useRef, useState } from "react"
import { ArrowRight, Check, CircleDot, ExternalLink, GitFork, Play, ShieldCheck, Sparkles, Terminal, Video } from "lucide-react"
import { BlurText } from "@/components/reactbits/BlurText"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import "./App.css"

const videoSources = [
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260702_051048_5ef213b5-26db-4da8-b604-7ef823760b6b.mp4",
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260613_180732_a54afbf6-b30d-470e-861f-669871f09f67.mp4",
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260423_084718_72a17915-4964-4059-afcd-22d59399b72e.mp4",
]
const scenes = [
  { id: "signal", label: "Signal", video: 0, filter: "saturate(1.25)", accent: "#9b8cff" },
  { id: "violet", label: "Violet", video: 1, filter: "saturate(1.2) hue-rotate(20deg)", accent: "#bd9cff" },
  { id: "ember", label: "Ember", video: 2, filter: "saturate(1.35) hue-rotate(310deg)", accent: "#ff9b77" },
  { id: "electric", label: "Electric", video: 0, filter: "saturate(1.8) hue-rotate(180deg)", accent: "#72d9ff" },
  { id: "acid", label: "Acid", video: 1, filter: "saturate(1.7) hue-rotate(70deg)", accent: "#c8f36a" },
  { id: "noir", label: "Noir", video: 2, filter: "grayscale(.85) contrast(1.4)", accent: "#d6d4e5" },
  { id: "infrared", label: "Infrared", video: 0, filter: "saturate(2) hue-rotate(290deg)", accent: "#ff6dca" },
  { id: "frost", label: "Frost", video: 1, filter: "saturate(.75) hue-rotate(150deg) brightness(1.15)", accent: "#a4d5ff" },
  { id: "mono", label: "Mono", video: 2, filter: "grayscale(1) contrast(1.15)", accent: "#ffffff" },
  { id: "gold", label: "Gold", video: 0, filter: "sepia(.55) saturate(1.4) hue-rotate(350deg)", accent: "#ffd47a" },
] as const
const metrics = [["20×", "target trials"], ["01", "control path"], ["0", "assumed claims"]]
const surfaceModes = [
  { id: "glass", label: "Glass" },
  { id: "line", label: "Line" },
  { id: "dense", label: "Dense" },
] as const

function App() {
  const [scene, setScene] = useState<(typeof scenes)[number]>(scenes[0])
  const [surface, setSurface] = useState<(typeof surfaceModes)[number]>(surfaceModes[0])
  const videoRef = useRef<HTMLVideoElement>(null)
  useEffect(() => { videoRef.current?.load(); void videoRef.current?.play().catch(() => undefined) }, [scene.video])
  return (
    <div className={`site surface-${surface.id}`} style={{ "--accent": scene.accent } as React.CSSProperties}>
      <div className="hero-wrap">
        <video ref={videoRef} className="hero-video" style={{ filter: scene.filter }} autoPlay muted loop playsInline aria-hidden="true"><source src={videoSources[scene.video]} type="video/mp4" /></video>
        <div className="hero-wash" /><div className="hero-grid" />
        <nav className="nav shell"><a className="brand" href="https://github.com/dshak1/receipts"><span className="brand-mark"><CircleDot size={16} /></span><span>receipts</span></a><div className="nav-links"><a href="#proof">Proof</a><a href="#how">How it works</a><a href="#sources">Sources</a><Button asChild size="sm" variant="outline"><a href="https://github.com/dshak1/receipts"><GitFork size={14} /> GitHub</a></Button></div></nav>
        <main className="hero shell"><div className="hero-copy"><Badge variant="outline" className="eyebrow"><span className="pulse-dot" /> RELIABILITY CI FOR COMPUTER-USE AGENTS</Badge><h1><BlurText text="Your agent said it succeeded." /><br /><span className="accent-text">Show me the receipts.</span></h1><p className="hero-lede">Run a task repeatedly on isolated Solari browsers. Verify what actually happened, independent of what the agent claims.</p><div className="hero-actions"><Button asChild size="lg"><a href="https://github.com/dshak1/receipts#quickstart">Run the quickstart <ArrowRight /></a></Button><Button asChild size="lg" variant="outline"><a href="#proof"><Play /> See the proof</a></Button></div><div className="hero-meta"><span><ShieldCheck size={15} /> deterministic checks</span><span><Video size={15} /> session replay</span><span><Terminal size={15} /> CI gate</span></div></div><aside className="scene-panel" aria-label="Hero background and surface selector"><div className="scene-panel-head"><span><Sparkles size={14} /> Scene library</span><Badge variant="secondary">10 variants</Badge></div><Tabs value={scene.id} onValueChange={(value) => setScene(scenes.find((item) => item.id === value) ?? scenes[0])} orientation="vertical"><TabsList className="scene-tabs">{scenes.map((item, index) => <TabsTrigger key={item.id} value={item.id} className="scene-tab"><span className="scene-index">{String(index + 1).padStart(2, "0")}</span><span>{item.label}</span>{item.video < 3 && <span className="scene-live" />}</TabsTrigger>)}</TabsList></Tabs><div className="surface-switch"><span>Surface recipe</span><Tabs value={surface.id} onValueChange={(value) => setSurface(surfaceModes.find((item) => item.id === value) ?? surfaceModes[0])}><TabsList>{surfaceModes.map((item) => <TabsTrigger key={item.id} value={item.id}>{item.label}</TabsTrigger>)}</TabsList></Tabs></div><p className="scene-note">Three supplied motion studies, seven color treatments. Change the atmosphere without changing the system.</p></aside></main>
        <div className="scroll-cue shell"><span>scroll to inspect the evidence</span><span className="scroll-line" /></div>
      </div>
      <section id="proof" className="proof-section shell section-pad"><div className="section-kicker">THE PRODUCT IN ONE SCREEN</div><div className="section-heading"><h2>Claims are cheap.<br /><span className="muted-text">Evidence compounds.</span></h2><p>The agent narrates. Receipts checks the world after the narration ends. Every run becomes an artifact your team can inspect, replay, and gate.</p></div><div className="metrics-grid">{metrics.map(([value, label]) => <Card key={label} className="metric-card"><CardContent><div className="metric-value">{value}</div><div className="metric-label">{label}</div></CardContent></Card>)}</div><Card className="console-card"><CardHeader><div className="console-top"><CardTitle><span className="window-dots"><i /><i /><i /></span> receipts / demo-request-access</CardTitle><Badge><span className="status-dot" /> FIXTURE REPORT</Badge></div></CardHeader><CardContent><div className="console-grid"><div className="console-claim"><span className="console-label">AGENT CLAIM</span><strong>success</strong><code>“Your request is in the review queue.”</code></div><div className="console-arrow"><ArrowRight /></div><div className="console-verdict"><span className="console-label">INDEPENDENT VERDICT</span><strong className="red">false_positive</strong><code>#confirmation-code not found</code></div></div><div className="console-foot"><span><Check size={14} /> Positive control path</span><span>20 target trials · 3 concurrent</span><Button asChild variant="ghost" size="sm"><a href="https://github.com/dshak1/receipts#evidence">Open report <ExternalLink size={13} /></a></Button></div></CardContent></Card></section>
      <section id="how" className="how-section section-pad"><div className="shell"><div className="section-kicker">THE LOOP</div><div className="section-heading"><h2>Four layers between<br /><span className="muted-text">a click and a green check.</span></h2><p>Built for teams who are done shipping on vibes.</p></div><div className="steps-grid">{[["01", "Control", "Prove the task is possible with a deterministic Playwright baseline."], ["02", "Execute", "Run isolated, recorded trials on Solari browsers at useful scale."], ["03", "Verify", "Check URL, DOM, and side effects after the agent has made its claim."], ["04", "Gate", "Turn verified rate and false-positive rate into a release decision."]].map(([number, title, text]) => <Card key={number} className="step-card"><CardHeader><span className="step-number">{number}</span><CardTitle>{title}</CardTitle></CardHeader><CardContent><p>{text}</p></CardContent></Card>)}</div></div></section>
      <section id="sources" className="sources-section shell section-pad"><div className="source-card"><div><div className="section-kicker">BUILT WITH SOURCES, NOT FOLKLORE</div><h2>Every primitive has a paper trail.</h2><p>The surface uses source-owned shadcn/ui primitives and a React Bits motion pattern. The composition and visual system are ours; the interaction foundations are documented and inspectable.</p></div><div className="source-links"><a href="https://ui.shadcn.com/docs/components/button"><Badge variant="outline">shadcn/ui · Button</Badge><ExternalLink size={14} /></a><a href="https://ui.shadcn.com/docs/components/card"><Badge variant="outline">shadcn/ui · Card</Badge><ExternalLink size={14} /></a><a href="https://ui.shadcn.com/docs/components/tabs"><Badge variant="outline">shadcn/ui · Tabs</Badge><ExternalLink size={14} /></a><a href="https://reactbits.dev/text-animations/blur-text"><Badge variant="outline">React Bits · BlurText</Badge><ExternalLink size={14} /></a></div></div></section>
      <footer className="shell footer"><span className="brand"><span className="brand-mark"><CircleDot size={16} /></span> receipts</span><span>Open source under MIT · built on <a href="https://getsolari.com">Solari</a></span><a href="https://github.com/dshak1/receipts"><GitFork size={14} /> GitHub</a></footer>
    </div>
  )
}
export default App
