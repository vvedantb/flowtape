import "@vvedantb/ui/landing.css";
import {
  IconArrowRight,
  IconBrandGithub,
  IconBrandNpm,
  IconChecklist,
  IconCode,
  IconFileExport,
  IconLayersLinked,
  IconPlayerPlay,
  IconRefresh,
  IconScan,
  IconShieldLock,
  IconTerminal2,
} from "@tabler/icons-react";
import {
  Button,
  LandingFeatureCard,
  LandingFooter,
  LandingNavMenu,
  LandingPageLayout,
  LandingSection,
  LandingSectionHeading,
  landingFooterLinkClass,
} from "@vvedantb/ui";
import { CodeBlock } from "./CodeBlock";
import { CopyButton } from "./CopyButton";
import { GITHUB_URL, HERO_CAPABILITIES, INSTALL_COMMAND, NAV_LINKS, NPM_URL } from "./content";
import { LandingCta, LandingHero, LandingNav, LandingReveal, LandingRevealItem } from "./kit";
import { AssertMock, ExportMock, HistoryMock, PromptMock, RecordMock, RedactionMock } from "./Mocks";
import { Tabs } from "./Tabs";
import { Wordmark } from "./Wordmark";

const github = { href: GITHUB_URL, icon: <IconBrandGithub size={16} aria-hidden /> };

function InstallButton({ size = "lg" }: { size?: "lg" | "default" }) {
  return (
    <CopyButton
      text={INSTALL_COMMAND}
      label={`Copy install command: ${INSTALL_COMMAND}`}
      size={size}
      className="w-full justify-between gap-3 font-mono text-xs min-[400px]:text-sm sm:w-auto"
    >
      <span>
        <span aria-hidden className="opacity-50">$ </span>
        {INSTALL_COMMAND}
      </span>
    </CopyButton>
  );
}

function Nav() {
  return (
    <LandingNav
      brand={<Wordmark />}
      homeLabel="flowtape home"
      links={NAV_LINKS}
      github={{ ...github, label: "flowtape on GitHub", icon: <IconBrandGithub size={18} /> }}
      actions={
        <Button asChild size="sm" variant="outline" className="hidden sm:inline-flex">
          <a href={NPM_URL} target="_blank" rel="noreferrer">
            <IconBrandNpm size={16} aria-hidden />
            npm
          </a>
        </Button>
      }
      menu={
        <LandingNavMenu
          links={[...NAV_LINKS, { href: NPM_URL, label: "npm" }]}
          github={github}
        />
      }
    />
  );
}

function Hero() {
  return (
    <LandingHero
      eyebrow="No account. No cloud. No extension."
      title="Record a flow. Replay it with an agent."
      description="A dev-only overlay for Vite + React and Next.js. Click Record, use your app, export a Claude Code prompt."
      actions={
        <>
          <Button asChild size="lg" className="w-full sm:w-auto">
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">
              View on GitHub
              <IconArrowRight size={16} aria-hidden />
            </a>
          </Button>
          <InstallButton />
        </>
      }
      capabilities={HERO_CAPABILITIES}
    />
  );
}

const Bullets = ({ items }: { items: readonly React.ReactNode[] }) => (
  <ul className="mt-5 flex flex-col gap-2 text-sm leading-relaxed text-muted">
    {items.map((b, i) => (
      <li key={i} className="flex gap-2.5">
        <span className="mt-2 size-1 shrink-0 rounded-full bg-foreground/50" aria-hidden />
        <span>{b}</span>
      </li>
    ))}
  </ul>
);

const code = "rounded bg-surface-secondary px-1 py-0.5 font-mono text-[0.85em] text-foreground";
const C = ({ children }: { children: React.ReactNode }) => <code className={code}>{children}</code>;

function DemoCopy({ title, text, bullets }: { title: string; text: React.ReactNode; bullets: readonly React.ReactNode[] }) {
  return (
    <div>
      <h3 className="text-xl font-semibold tracking-[-0.02em] sm:text-2xl">{title}</h3>
      <p className="mt-3 text-sm leading-relaxed text-muted sm:text-base">{text}</p>
      <Bullets items={bullets} />
    </div>
  );
}

function Stage({ copy, mock, flip = false }: { copy: React.ReactNode; mock: React.ReactNode; flip?: boolean }) {
  return (
    <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-2 lg:gap-14">
      <div className={flip ? "min-w-0 lg:order-2" : "min-w-0"}>{copy}</div>
      <div className={flip ? "min-w-0 lg:order-1" : "min-w-0"}>{mock}</div>
    </div>
  );
}

function Demo() {
  return (
    <LandingSection id="demo">
      <LandingReveal>
        <LandingRevealItem>
          <LandingSectionHeading
            eyebrow="See it work"
            heading="The overlay, in four steps"
            intro="Illustrations of the overlay. Click anything."
          />
        </LandingRevealItem>
        <LandingRevealItem className="mt-10">
          <Tabs
            label="Demo steps"
            items={[
              {
                id: "record",
                label: "Record",
                icon: <IconPlayerPlay size={16} aria-hidden />,
                content: (
                  <Stage
                    copy={
                      <DemoCopy
                        title="Click Record. Use the app."
                        text="flowtape logs the current page, then every click, field value, form submit and client-side navigation."
                        bullets={[
                          "Clicks inside the overlay are ignored.",
                          "Typing is debounced. Each field records its final value once.",
                          "The recording survives reloads in the same tab.",
                        ]}
                      />
                    }
                    mock={<RecordMock />}
                  />
                ),
              },
              {
                id: "assert",
                label: "Assert",
                icon: <IconChecklist size={16} aria-hidden />,
                content: (
                  <Stage
                    copy={
                      <DemoCopy
                        title="Check what should be true."
                        text="While you record, click Assert, choose a check, then click an element. The app never receives that click."
                        bullets={[
                          <><b className="font-medium text-foreground">Text:</b> the element is visible and shows its current text.</>,
                          <><b className="font-medium text-foreground">Count:</b> how many elements match one of the rows.</>,
                          <><b className="font-medium text-foreground">Gone:</b> the element leaves the page after the next action.</>,
                          "Esc or Cancel stops picking.",
                        ]}
                      />
                    }
                    mock={<AssertMock />}
                  />
                ),
              },
              {
                id: "export",
                label: "Export",
                icon: <IconFileExport size={16} aria-hidden />,
                content: (
                  <Stage
                    copy={
                      <DemoCopy
                        title="Stop, name, export."
                        text="The name becomes the file slug. Export writes the flow as JSON, a Markdown prompt and a draft e2e test."
                        bullets={[
                          "Flows and prompts are meant to be committed.",
                          "Exporting under the same name overwrites the files.",
                          "The overlay shows the saved path and a Copy prompt button.",
                        ]}
                      />
                    }
                    mock={<ExportMock />}
                  />
                ),
              },
              {
                id: "prompt",
                label: "Prompt",
                icon: <IconTerminal2 size={16} aria-hidden />,
                content: (
                  <Stage
                    copy={
                      <DemoCopy
                        title="A prompt Claude Code can follow."
                        text={<>Each prompt has seven sections. Assertions and fuzz hints are heuristics, so fill in the <C>TODO</C> lines before you rely on them.</>}
                        bullets={[
                          "Redacted fields name an environment variable.",
                          "The agent is told never to print, log or screenshot it.",
                        ]}
                      />
                    }
                    mock={<PromptMock />}
                  />
                ),
              },
            ]}
          />
        </LandingRevealItem>
      </LandingReveal>
    </LandingSection>
  );
}

const CLAUDE_CMD = `# Interactive
claude "Follow @.flowtape/prompts/login-and-add-note.md against the running app"
# Headless
claude -p "$(cat .flowtape/prompts/login-and-add-note.md)"`;

const HISTORY_ROWS = [
  ["Starts", "When you click Record", "When you switch it on (off by default)"],
  ["Ends", "When you click Stop", "When you switch it off or close the tab"],
  ["Output", "flows/<slug>.json and prompts/<slug>.md", "history/<date>-<sessionId>.jsonl"],
  ["Git", "Committed", "Ignored"],
] as const;

function Features() {
  return (
    <>
      <LandingSection id="features" className="pb-8 sm:pb-12 lg:pb-16">
        <LandingReveal>
          <LandingRevealItem>
            <Stage
              flip
              copy={
                <>
                  <LandingSectionHeading
                    eyebrow="Claude Code"
                    heading="Hand the journey to an agent"
                    intro="Start your dev server and give Claude Code a browser tool, for example Playwright MCP. Then point it at the prompt."
                  />
                  <Bullets
                    items={[
                      <>Interactive, or headless with <C>claude -p</C>.</>,
                      <>Set <C>$FLOWTAPE_PASSWORD</C> to a <b className="font-medium text-foreground">test</b> credential in that shell.</>,
                      "Every export also writes a draft test for the e2e runner.",
                    ]}
                  />
                </>
              }
              mock={<CodeBlock title="Terminal" code={CLAUDE_CMD} copy />}
            />
          </LandingRevealItem>
        </LandingReveal>
      </LandingSection>

      <LandingSection className="py-8 sm:py-12 lg:py-16">
        <LandingReveal>
          <LandingRevealItem>
            <Stage
              copy={
                <>
                  <LandingSectionHeading
                    eyebrow="Session history"
                    heading="A log of what you did. Off until you switch it on."
                    intro="One JSONL file per browser tab, appended every second. Never turned into a named flow. Use Record for that."
                  />
                  <Bullets
                    items={[
                      "Navigations, clicks, field values, form submits and uncaught errors.",
                      "Errors keep a scrubbed message, file, line and column. No stack.",
                      <>No network capture: no request bodies, cookies or <C>Authorization</C> headers.</>,
                      <>Gitignored: <C>**/.flowtape/history/</C></>,
                    ]}
                  />
                </>
              }
              mock={<HistoryMock />}
            />
          </LandingRevealItem>
          <LandingRevealItem className="mt-10">
            <div className="overflow-x-auto rounded-2xl border border-separator bg-surface">
              <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-separator">
                    <td className="w-24" />
                    <th scope="col" className="px-4 py-3 font-medium">Record flow</th>
                    <th scope="col" className="px-4 py-3 font-medium">Session history</th>
                  </tr>
                </thead>
                <tbody className="text-muted">
                  {HISTORY_ROWS.map(([k, a, b]) => (
                    <tr key={k} className="border-b border-separator last:border-0">
                      <th scope="row" className="px-4 py-3 font-medium text-foreground">{k}</th>
                      <td className="px-4 py-3">{a}</td>
                      <td className="px-4 py-3">{b}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-sm text-muted">
              Review it with an agent, or list the files with <C>npx @vvedantb/flowtape history</C>.
            </p>
          </LandingRevealItem>
        </LandingReveal>
      </LandingSection>

      <LandingSection className="pt-8 sm:pt-12 lg:pt-16">
        <LandingReveal>
          <LandingRevealItem>
            <Stage
              flip
              copy={
                <>
                  <LandingSectionHeading
                    eyebrow="Redaction and local-first"
                    heading="Redacted before it is stored"
                    intro="Redaction runs in the browser, on the server before files are written, and over the final Markdown. Session history gets the first two."
                  />
                  <Bullets
                    items={[
                      <><b className="font-medium text-foreground">Password fields</b> never store a value, only its length.</>,
                      <><b className="font-medium text-foreground"><C>data-flowtape-mask</C></b> records every field inside type-only.</>,
                      <><b className="font-medium text-foreground">Allowlist mode</b> for apps that handle personal data.</>,
                      <><b className="font-medium text-foreground">Pattern scrub</b> covers tokens, JWTs, NHS numbers, emails, UK postcodes and mobiles.</>,
                      "The pattern scrub is a safety net, not a guarantee. Review a flow before you commit it.",
                    ]}
                  />
                </>
              }
              mock={<RedactionMock />}
            />
          </LandingRevealItem>
        </LandingReveal>
      </LandingSection>
    </>
  );
}

const MORE = [
  { icon: IconLayersLinked, title: "Vite and Next.js", description: "A Vite plugin, or route handlers for the Next.js App and Pages Routers." },
  { icon: IconChecklist, title: "Assertions", description: "Text, Count and Gone checks become Check: steps in the prompt." },
  { icon: IconCode, title: "e2e export", description: "A draft test for the e2e runner. Exact steps, no model, no API key." },
  { icon: IconPlayerPlay, title: "Replay scripts", description: "Record and replay from the CLI with Playwright, an optional peer dependency." },
  { icon: IconRefresh, title: "Survives reloads", description: "Redacted events live in sessionStorage until the tab closes or you click Clear." },
  { icon: IconShieldLock, title: "Allowlist mode", description: "data-flowtape-allowlist records fields type-only and drops element text." },
  { icon: IconScan, title: "Audit", description: "flowtape audit scans saved files for anything that still looks sensitive." },
  { icon: IconTerminal2, title: "Dev only", description: "The middleware runs under vite dev or next dev. The overlay is off in production." },
] as const;

function More() {
  return (
    <LandingSection id="more">
      <LandingReveal>
        <LandingRevealItem>
          <LandingSectionHeading eyebrow="More" heading="Everything else" intro="Small facts from the README." />
        </LandingRevealItem>
        <LandingRevealItem className="mt-10">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {MORE.map((f) => (
              <LandingFeatureCard key={f.title} {...f} />
            ))}
          </div>
        </LandingRevealItem>
      </LandingReveal>
    </LandingSection>
  );
}

const VITE_CONFIG = `import react from '@vitejs/plugin-react';
import { flowtape } from '@vvedantb/flowtape/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [flowtape(), react()],
});`;

const VITE_MAIN = `import { FlowtapeOverlay } from '@vvedantb/flowtape';

createRoot(root).render(
  <>
    <App />
    <FlowtapeOverlay />
  </>,
);`;

const NEXT_ROUTE = `import { flowtapeRouteHandlers } from '@vvedantb/flowtape/next';

export const { GET, POST } = flowtapeRouteHandlers();`;

const NEXT_LAYOUT = `import { FlowtapeOverlay } from '@vvedantb/flowtape/next/client';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        {process.env.NODE_ENV === 'development' && <FlowtapeOverlay />}
      </body>
    </html>
  );
}`;

const Step = ({ n, label, children }: { n: number; label: string; children: React.ReactNode }) => (
  <div>
    <p className="mb-2 text-sm text-muted">
      <b className="font-medium text-foreground">{n}.</b> {label}
    </p>
    {children}
  </div>
);

function Setup() {
  const install = <Step n={1} label="Install the package."><CodeBlock title="Terminal" code={INSTALL_COMMAND} copy /></Step>;
  return (
    <LandingSection id="setup">
      <LandingReveal>
        <LandingRevealItem>
          <LandingSectionHeading
            eyebrow="Setup"
            heading="Add it to your app"
            intro="Render the overlay behind import.meta.env.DEV to keep it out of the production bundle."
          />
        </LandingRevealItem>
        <LandingRevealItem className="mt-10">
          <Tabs
            label="Framework"
            items={[
              {
                id: "vite",
                label: "Vite + React",
                content: (
                  <div className="grid max-w-3xl grid-cols-1 gap-6">
                    {install}
                    <Step n={2} label="Add the plugin."><CodeBlock title="vite.config.ts" code={VITE_CONFIG} /></Step>
                    <Step n={3} label="Mount the overlay once."><CodeBlock title="main.tsx" code={VITE_MAIN} /></Step>
                  </div>
                ),
              },
              {
                id: "next",
                label: "Next.js",
                content: (
                  <div className="grid max-w-3xl grid-cols-1 gap-6">
                    {install}
                    <Step n={2} label="Add the route (App Router)."><CodeBlock title="app/api/flowtape/[...path]/route.ts" code={NEXT_ROUTE} /></Step>
                    <Step n={3} label="Render the overlay in the layout."><CodeBlock title="app/layout.tsx" code={NEXT_LAYOUT} /></Step>
                    <p className="text-sm text-muted">
                      Next.js uses <C>/api/flowtape</C>, not <C>/__flowtape</C>. Pages Router and handler options are in the README.
                    </p>
                  </div>
                ),
              },
            ]}
          />
        </LandingRevealItem>
      </LandingReveal>
    </LandingSection>
  );
}

function Cta() {
  return (
    <LandingCta
      title="Record the next flow"
      description="Install the package, mount the overlay, click Record."
      action={
        <div className="flex flex-col items-stretch gap-2.5 sm:flex-row sm:items-center sm:gap-3">
          <Button asChild size="lg">
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">
              View on GitHub
              <IconArrowRight size={16} aria-hidden />
            </a>
          </Button>
          <InstallButton />
        </div>
      }
    />
  );
}

function Footer() {
  return (
    <LandingFooter
      brand={<Wordmark />}
      tagline="Record user journeys in Vite + React and Next.js apps. Replay them with Claude Code. Local-first, dev-only."
      links={NAV_LINKS}
      actions={
        <a href={NPM_URL} target="_blank" rel="noreferrer" className={landingFooterLinkClass}>
          npm
        </a>
      }
      github={{ ...github, label: "flowtape on GitHub", icon: <IconBrandGithub size={18} /> }}
    />
  );
}

export function LandingPage() {
  return (
    <LandingPageLayout nav={<Nav />} hero={<Hero />} footer={<Footer />}>
      <Demo />
      <Features />
      <More />
      <Setup />
      <Cta />
    </LandingPageLayout>
  );
}
