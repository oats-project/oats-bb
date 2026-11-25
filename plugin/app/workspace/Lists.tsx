// The Capabilities, Teams and Machines tabs of the Workspace page: what `oats capabilities`,
// `oats teams` and `oats server list` answer for this deployment. Lists only: nothing here acts,
// and the Machines tab runs no check. (The audit of the hidden pages and its ruling, 25 Nov 2026:
// C1 to C9, T1 to T11, M1 to M9.)
import { useState } from "react";
import type { ReactNode } from "react";
import { count } from "../format";
import { useOats } from "../oats";
import { useRead } from "../store";
import type { Result } from "../store";
import { Disclosure, Fact, Facts, Heading, Note, Notice, SearchField } from "../ui";
import { shown } from "../ui/text";
import { Before, FILTER_FROM, Frame, matches, OneLine, TEAM_UNMAPPED } from "./Workspace";

const ROW = "flex min-w-0 flex-col gap-0.5 border-b border-border py-2 last:border-b-0";
const TAG = "shrink-0 text-xs text-muted-foreground";
/** A fact one press away, under a row's Details: its label, then its value on a line of its own (it can be selected whole). */
const Under = ({ label, children }: { label: string; children: string }) => (
  <p className="break-all text-xs text-muted-foreground">
    <span>{`${shown(label)}: `}</span>
    <span className="text-foreground">{shown(children)}</span>
  </p>
);

// ---- Capabilities ----

type Capability = Result<"capabilities">["capabilities"][number];
/** The three places every soul has, in the Desktop's order, as the kernel names them (`layer`). */
const CORE = [
  ["knowledge", "Knowledge"],
  ["messaging", "Messaging"],
  ["tasks", "Tasks"],
] as const;

/**
 * What capabilities are, in the Desktop's words (awebai/oats 5be291249, packages/desktop/renderer/
 * about-dialog.mjs `ABOUT_COPY.capabilities`), one press away: the ONE place of the tab that
 * explains (the ruling's R2: none of the Desktop's explaining paragraphs stands on the page).
 */
const ABOUT = {
  button: "About capabilities",
  paragraphs: [
    "A capability is a reusable bundle of skills, commands and instructions, given to every soul whose work needs it.",
    "A soul names the capabilities it needs. When an agent starts, it gets a copy of each one, and the capability’s instructions are injected into the agent’s composed AGENTS.md, after the soul’s own.",
    "Each capability comes from one of three places:",
  ],
  places: [
    ["Workspace owned", "Defined in one of the workspace’s repos. Any soul can use it, always at that repo’s latest version."],
    ["Repo owned", "Defined in one repo and kept to it. Only souls from that same repo can use it."],
    ["Packages", "Installed into the workspace at a pinned version, the same on every machine."],
  ],
  after: [
    "Three capabilities are core: knowledge (what an agent knows and learns), messaging (who it can talk to) and tasks (where its work is tracked). A soul has at most one of each. Every other capability is additional: a soul can have any number.",
  ],
} as const;

/** The capabilities a search leaves: by a capability's id and what it does. */
const foundCapabilities = (capabilities: readonly Capability[], query: string): Capability[] => capabilities.filter((capability) => matches(query, capability.id, capability.description));

function CapabilityList({ capabilities, query, onQuery }: { capabilities: readonly Capability[]; query: string; onQuery: (query: string) => void }) {
  if (capabilities.length === 0) return <Note>No capabilities.</Note>;
  const found = foundCapabilities(capabilities, query);
  // The kernel says which place a capability fills; one that says nothing of any (an older answer) has no Core part.
  const told = capabilities.some((capability) => capability.layer !== undefined);
  // EVERY capability of a place: the read does not say which of two a soul gets, so none is picked.
  const fills = (layer: string) => capabilities.filter((capability) => capability.layer === layer).map((capability) => capability.id);
  return (
    <>
      {capabilities.length >= FILTER_FROM ? <SearchField label="Search capabilities" placeholder="Search capabilities" value={query} onChange={onQuery} /> : null}
      {told && query === "" ? (
        <section data-testid="oats-capabilities-core" className="flex min-w-0 flex-col gap-1">
          <Heading>Core</Heading>
          <Facts>
            {CORE.map(([layer, label]) => (
              <Fact key={layer} label={label}>
                {shown(fills(layer).join(", ") || "none")}
              </Fact>
            ))}
          </Facts>
        </section>
      ) : null}
      {found.length === 0 ? <Note>Nothing matches.</Note> : null}
      <ul className="flex min-w-0 flex-col">
        {found.map((capability) => (
          <li key={capability.id} data-testid="oats-capability-row" title={shown(capability.id)} className={ROW}>
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <span className="min-w-0 break-words font-semibold">{shown(capability.id)}</span>
              {capability.layer ? <span className={TAG}>core</span> : null}
              {capability.repoOnly === true ? <span className={TAG}>repo only</span> : null}
              {/* Who made it, as the Desktop's row says it: "by <source>". */}
              {capability.source === undefined ? null : <span className={TAG}>{`by ${shown(capability.source.label)}`}</span>}
            </div>
            {/* What it does, on ONE line; whole in the line's title (and, later, on the capability's own page). */}
            {capability.description === "" ? null : <OneLine testId="oats-capability-does" text={capability.description} />}
          </li>
        ))}
      </ul>
      <Disclosure summary={ABOUT.button} testId="oats-capabilities-about">
        <div className="flex max-w-prose flex-col gap-2 text-xs text-muted-foreground">
          {ABOUT.paragraphs.map((text) => (
            <p key={text}>{text}</p>
          ))}
          <dl className="flex flex-col gap-1">
            {ABOUT.places.map(([name, text]) => (
              <div key={name}>
                <dt className="font-semibold text-foreground">{name}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
          {ABOUT.after.map((text) => (
            <p key={text}>{text}</p>
          ))}
        </div>
      </Disclosure>
    </>
  );
}

export function CapabilitiesPage() {
  const oats = useOats();
  const read = useRead("capabilities");
  const [query, setQuery] = useState("");
  return (
    <Frame tab="capabilities" testId="oats-capabilities-page" {...(read.data === undefined || query.trim() === "" ? {} : { found: foundCapabilities(read.data.capabilities, query).length })}>
      {/* (Nothing of this tab is the roster's: it says nothing of the roster.) */}
      <Before oats={oats} read={read} roster={false} />
      {read.data === undefined ? null : <CapabilityList capabilities={read.data.capabilities} query={query} onQuery={setQuery} />}
    </Frame>
  );
}

// ---- Teams ----

type Teams = Result<"teams">;
type Team = Teams["teams"][number];

type Soul = Result<"souls">["souls"][number];

/**
 * Who joins a team, from what the kernel RESOLVED for each soul (`oats souls`: a soul's teams, its
 * default first). The rule itself (a default, the most specific pattern, this computer's teams) is
 * the kernel's and is not restated here. Null where no soul's teams are known (the souls are not
 * read yet, or a kernel that does not say); a soul the kernel could not resolve is left out of the
 * claim.
 */
function joins(team: Team, souls: readonly Soul[] | undefined): { may: string; defaultFor: string | null } | null {
  const known = (souls ?? []).filter((soul) => soul.teams !== undefined);
  if (known.length === 0) return null;
  const inIt = known.filter((soul) => soul.teams!.some((each) => each.label === team.label)).map((soul) => soul.name);
  const out = known.filter((soul) => !inIt.includes(soul.name)).map((soul) => soul.name);
  const may = inIt.length === 0 ? "no soul" : out.length === 0 ? "every soul" : out.length < inIt.length ? `every soul but ${out.join(", ")}` : inIt.join(", ");
  // Whose default it is, said only of a team that is not the deployment's default.
  const firsts = team.isDefault ? [] : known.filter((soul) => soul.teams!.some((each) => each.isDefault && each.label === team.label)).map((soul) => soul.name);
  return { may, defaultFor: firsts.length === 0 ? null : firsts.join(", ") };
}

function TeamRow({ team, souls, agents }: { team: Team; souls: readonly Soul[] | undefined; agents: number | null }) {
  const who = joins(team, souls);
  const under: [string, string][] = [
    ...(team.team === null ? [] : [["Address", team.team] as [string, string]]),
    ...(who === null ? [] : [["May join", who.may] as [string, string]]),
    ...(who === null || who.defaultFor === null ? [] : [["Default for", who.defaultFor] as [string, string]]),
    ...(team.at ? [["Declared in", team.at] as [string, string]] : []),
  ];
  return (
    <li data-testid="oats-team-row" className={ROW}>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className="min-w-0 break-words font-semibold">{shown(team.label)}</span>
        {team.isDefault ? <span className={TAG}>Default team</span> : null}
        {/* A team with no address on the messaging provider yet: nobody can be counted under it. */}
        {team.team === null ? <span className="shrink-0 text-xs text-warning-text">No address yet</span> : agents === null || agents === 0 ? null : <span className={TAG}>{count(agents, "agent")}</span>}
      </div>
      {team.description ? <p className="break-words text-xs text-muted-foreground">{shown(team.description)}</p> : null}
      {under.length === 0 ? null : (
        <Disclosure summary="Details" testId="oats-team-details">
          {under.map(([label, value]) => (
            <Under key={label} label={label}>
              {value}
            </Under>
          ))}
        </Disclosure>
      )}
    </li>
  );
}

export function TeamsPage() {
  const read = useRead("teams");
  const oats = useOats();
  const answer = read.data;
  const teams = answer?.teams ?? [];
  // Which teams each soul joins is the souls' read (the kernel's resolved answer per soul).
  const souls = useRead("souls").data?.souls;
  const resolved = (souls ?? []).filter((soul) => soul.teams !== undefined);
  const agentsOn = (team: Team) => (team.team === null || oats.phase !== "ready" ? null : oats.agents.filter((agent) => agent.team === team.team).length);
  // Two groups, each under its heading, only where both are there: the workspace's teams, and this computer's own.
  const shared = teams.filter((team) => team.local !== true);
  const local = teams.filter((team) => team.local === true);
  const list = (rows: readonly Team[]): ReactNode => (
    <ul className="flex min-w-0 flex-col">
      {rows.map((team) => (
        <TeamRow key={team.label} team={team} souls={souls} agents={agentsOn(team)} />
      ))}
    </ul>
  );
  // What stops a spawn is said first, as a notice: the default team has no address yet (the kernel's code for it, on
  // the default team). The kernel's own words are under its Details. One notice on a screen: while the roster's own
  // stands (OATS cannot be read), this one waits.
  const unread = oats.phase === "failed" || (oats.phase === "ready" && oats.stale !== null);
  const stops = unread ? [] : (answer?.problems ?? []).filter((problem) => problem.code === TEAM_UNMAPPED && problem.isDefault);
  return (
    <Frame tab="teams" testId="oats-teams-page">
      {/* Each team's count of agents is the roster's: while OATS cannot be read, the notice says so (the counts are then the last read, or absent). */}
      <Before oats={oats} read={read} />
      {answer === undefined ? null : (
        <>
          {stops.map((problem) => (
            <Notice key={problem.label ?? problem.message} tone="warning" title={`The default team ${shown(problem.label ?? "")} has no address yet: nothing can be spawned until it has one.`} details={[problem.message, problem.fix]} />
          ))}
          {teams.length === 0 ? <Note>No teams.</Note> : null}
          {shared.length > 0 && local.length > 0 ? (
            <>
              <section data-testid="oats-teams-shared" className="flex min-w-0 flex-col gap-1">
                <Heading>Workspace</Heading>
                {list(shared)}
              </section>
              <section data-testid="oats-teams-local" className="flex min-w-0 flex-col gap-1">
                <Heading>This computer</Heading>
                {list(local)}
              </section>
            </>
          ) : (
            list(teams)
          )}
          {resolved.length === 0 ? null : (
            <Disclosure summary="Which teams each soul may join" testId="oats-teams-may-join">
              {resolved.map((soul) => (
                <Under key={soul.name} label={soul.name}>
                  {soul.teams!.length === 0 ? "none" : soul.teams!.map((team) => team.label).join(", ")}
                </Under>
              ))}
            </Disclosure>
          )}
        </>
      )}
    </Frame>
  );
}

// ---- Machines ----

type Machine = Result<"machines">["machines"][number];

function MachineRow({ machine, name, agents }: { machine: Machine; name: string; agents: number | null }) {
  const under: [string, string][] = [
    // (Its id in the registry, where its name is another.)
    ...(!machine.isThisMachine && machine.label !== null ? [["Id", machine.id] as [string, string]] : []),
    ...(machine.route === null ? [] : [["ssh host", machine.route] as [string, string]]),
    ...(machine.folder === null ? [] : [["Folder", machine.folder] as [string, string]]),
  ];
  return (
    <li data-testid="oats-machine-row" data-this={machine.isThisMachine ? "" : undefined} className={ROW}>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className="min-w-0 break-words font-semibold">{shown(name)}</span>
        {machine.isThisMachine ? <span className={TAG}>this computer</span> : null}
        {agents === null || agents === 0 ? null : <span className={TAG}>{count(agents, "agent")}</span>}
      </div>
      {under.length === 0 ? null : (
        <Disclosure summary="Details" testId="oats-machine-details">
          {under.map(([label, value]) => (
            <Under key={label} label={label}>
              {value}
            </Under>
          ))}
        </Disclosure>
      )}
    </li>
  );
}

export function MachinesPage() {
  const read = useRead("machines");
  const oats = useOats();
  const machines = read.data?.machines ?? [];
  return (
    <Frame tab="machines" testId="oats-machines-page">
      {/* This computer's name and its agents are the roster's: while OATS cannot be read, the notice says so, above what was last read. */}
      <Before oats={oats} read={read} />
      {read.data === undefined ? null : machines.length === 0 ? (
        <Note>No machines.</Note>
      ) : (
        // ONE list: this computer first, then each machine OATS has registered, by its name.
        <ul className="flex min-w-0 flex-col">
          {machines.map((machine) => (
            <MachineRow
              key={machine.id}
              machine={machine}
              name={machine.isThisMachine && oats.phase === "ready" ? oats.deployment.machine : (machine.label ?? machine.id)}
              agents={machine.isThisMachine && oats.phase === "ready" ? oats.agents.length : null}
            />
          ))}
        </ul>
      )}
    </Frame>
  );
}
