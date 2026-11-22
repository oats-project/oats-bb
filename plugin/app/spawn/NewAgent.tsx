// What a soul's page shows under "New agent" for a soul that can be spawned: the button that opens
// the form's own page with that soul chosen (app/spawn/Page.tsx). The form itself is no longer on
// a soul's page: its first field is the soul.
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { Result } from "../store";
import { Button } from "../ui";
import { openNewAgent } from "./index";

type Soul = Result<"souls">["souls"][number];

export function NewAgent({ soul }: { soul: Soul }) {
  const navigate = useBbNavigate();
  return (
    <div>
      <Button variant="primary" data-testid="oats-soul-new-agent" onClick={() => openNewAgent(navigate, { soul: soul.name })}>
        New agent
      </Button>
    </div>
  );
}
