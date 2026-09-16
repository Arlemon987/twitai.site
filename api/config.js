// Public subscription display configuration.
// This file contains no secret credentials.
// Update these values to match your manual crypto payment setup.

export const PAYMENT_CONFIG = {
  network: "BSC-BNB SMART CHAIN",
  wallet: "0xEd0705Eab4eD0579466FF7aFF6B3adB7131F1868",

  plans: {
    month: {
      label: "1 Month",
      months: 1,
      amount: "$3.5"
    },
    three_months: {
      label: "3 Months",
      months: 3,
      amount: "$10"
    },
    six_months: {
      label: "6 Months",
      months: 6,
      amount: "$18"
    },
    year: {
      label: "1 Year",
      months: 12,
      amount: "$32"
    }
  }
};
