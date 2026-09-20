// Public subscription configuration.
// These values are intentionally public because users need them
// to make manual crypto payments.

export const PAYMENT_CONFIG = {
  network: "BNB SMART CHAIN || ETHEREUM MAIN CHAIN || BASE || ARBITRUM",

  wallet: "0xEd0705Eab4eD0579466FF7aFF6B3adB7131F1868",

  plans: {
    month: {
      label: "1 Month",
      months: 1,
      amount: "$4.90"
    },

    three_months: {
      label: "3 Months",
      months: 3,
      amount: "$12.9"
    },

    six_months: {
      label: "6 Months",
      months: 6,
      amount: "$24.9"
    },

    year: {
      label: "1 Year",
      months: 12,
      amount: "$42.9"
    }
  }
};

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed."
    });
  }

  return res.status(200).json(PAYMENT_CONFIG);
}
