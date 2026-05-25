import { ToolPlaceholder } from "../../core/ui/tool-placeholder";

export default function CallingTool() {
  return (
    <ToolPlaceholder
      name="AI Calling Tool"
      slug="callingtool"
      description="Enter a number, the backend places the call via Plivo/Exotel/Twilio through a Trigger.dev job (Architecture §3)."
    />
  );
}
