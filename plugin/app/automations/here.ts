// The machine the Automations page is about, for every component under the page: bb's name for
// the machine that holds the deployment (the lists' answer names it), as words.ts's `Here`.
import { createContext, useContext } from "react";
import { HERE, type Here } from "./words";

export const HereContext = createContext<Here>(HERE);
/** Whether the host scheduler runs, for what is drawn on a row's page: nothing there says a run is next while it is off. */
export const RunningContext = createContext(true);
export const useRunning = (): boolean => useContext(RunningContext);
export const useHere = (): Here => useContext(HereContext);
