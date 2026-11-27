// Walkthrough 1. Ticket Bot: "A ticket with acceptance items".
// Lives in the shared package @dash-checks/code-factory. Reads: handoff.
const { check, expect } = require("@trops/dash-check");

check("the ticket has acceptance items", ({ handoff }) => {
  expect(handoff.acceptance, "handoff.acceptance").toBeArray("The ticket's acceptance items aren't a list");
  expect(handoff.acceptance, "handoff.acceptance").not.toBeEmpty(
    "The ticket has no acceptance items: add them to the ticket, or write one per testable thing it asks for",
  );
});
