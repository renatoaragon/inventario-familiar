import { describe, expect, it } from "vitest";

import { computeSplit, LAWYER_PCT } from "@/lib/inventario/repo";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("computeSplit", () => {
  it("takes the lawyer fee off the top and splits the rest equally", () => {
    // R$4,000.00 gross, 4 heirs: R$200.00 fee, R$950.00 each.
    const { lawyerCents, netCents, heirShares } = computeSplit(400_000, 4);
    expect(lawyerCents).toBe(20_000);
    expect(netCents).toBe(380_000);
    expect(heirShares).toEqual([95_000, 95_000, 95_000, 95_000]);
  });

  it("uses the configured fee percentage", () => {
    const { lawyerCents } = computeSplit(100_000, 1);
    expect(lawyerCents).toBe((100_000 * LAWYER_PCT) / 100);
  });

  it("hands leftover cents to the first heirs, one each", () => {
    // Net of 95,001 cents across 4 heirs: 23,750 each plus 1 leftover cent.
    const { netCents, heirShares } = computeSplit(100_001, 4);
    expect(netCents).toBe(95_001);
    expect(heirShares).toEqual([23_751, 23_750, 23_750, 23_750]);
  });

  it("never loses a cent: fee + shares always equals gross minus expenses", () => {
    for (const gross of [1, 999, 100_001, 123_457, 400_000]) {
      for (const heirs of [1, 2, 3, 4, 7]) {
        const { lawyerCents, heirShares } = computeSplit(gross, heirs);
        expect(lawyerCents + sum(heirShares)).toBe(gross);
      }
    }
  });

  it("deducts same-month expenses from the gross before splitting", () => {
    // R$4,000.00 gross with R$800.00 of expenses due in the month.
    const { lawyerCents, netCents, heirShares } = computeSplit(400_000, 4, 80_000);
    expect(lawyerCents).toBe(20_000);
    expect(netCents).toBe(300_000);
    expect(heirShares).toEqual([75_000, 75_000, 75_000, 75_000]);
  });

  it("rounds the fee to the cent", () => {
    // 5% of 10,001 cents is 500.05, rounded to 500.
    expect(computeSplit(10_001, 1).lawyerCents).toBe(500);
  });

  it("degrades safely when expenses exceed the gross", () => {
    const { netCents, heirShares } = computeSplit(100_000, 4, 200_000);
    expect(netCents).toBeLessThan(0);
    expect(heirShares).toEqual([0, 0, 0, 0]);
  });

  it("returns an empty share list with zero heirs", () => {
    expect(computeSplit(100_000, 0).heirShares).toEqual([]);
  });
});
