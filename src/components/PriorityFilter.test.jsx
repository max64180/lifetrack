import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PriorityFilter from "./PriorityFilter";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key, opts) => opts?.defaultValue || _key,
  }),
}));

describe("PriorityFilter", () => {
  it("selects manual pay when choosing 'Da pagare'", async () => {
    const user = userEvent.setup();
    const setFilterMandatory = vi.fn();
    const setFilterAutoPay = vi.fn();
    const setFilterManual = vi.fn();
    const setFilterEstimateMissing = vi.fn();

    render(
      <PriorityFilter
        activeTab="timeline"
        filterMandatory={false}
        setFilterMandatory={setFilterMandatory}
        filterAutoPay={false}
        setFilterAutoPay={setFilterAutoPay}
        filterManual={false}
        setFilterManual={setFilterManual}
        filterEstimateMissing={false}
        setFilterEstimateMissing={setFilterEstimateMissing}
      />
    );

    await user.click(screen.getByRole("button", { name: /Priorità/i }));
    await user.click(screen.getByRole("button", { name: /Da pagare/i }));

    expect(setFilterManual).toHaveBeenCalledWith(true);
    expect(setFilterAutoPay).toHaveBeenCalledWith(false);
    expect(setFilterMandatory).toHaveBeenCalledWith(false);
    expect(setFilterEstimateMissing).toHaveBeenCalledWith(false);
  });
});
