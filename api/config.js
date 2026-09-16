// Public subscription display configuration.
// This file contains no secret credentials.
// Update these values to match your manual crypto payment setup.

export const PAYMENT_CONFIG = {
  network: "YOUR_NETWORK",
  wallet: "YOUR_PAYMENT_WALLET_ADDRESS",

  plans: {
    month: {
      label: "1 Month",
      months: 1,
      amount: "YOUR_1_MONTH_PRICE"
    },
    three_months: {
      label: "3 Months",
      months: 3,
      amount: "YOUR_3_MONTH_PRICE"
    },
    six_months: {
      label: "6 Months",
      months: 6,
      amount: "YOUR_6_MONTH_PRICE"
    },
    year: {
      label: "1 Year",
      months: 12,
      amount: "YOUR_1_YEAR_PRICE"
    }
  }
};
