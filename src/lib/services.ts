export const SERVICES = [
  {
    id: "essential",
    name: "Essential clean",
    description: "A thoughtful reset for the rooms you use every day.",
    duration: "2 hours",
    priceCents: 8900,
  },
  {
    id: "deep",
    name: "Deep clean",
    description:
      "Extra detail for kitchens, bathrooms, and everything between.",
    duration: "3 hours",
    priceCents: 14900,
  },
  {
    id: "move-out",
    name: "Move-in / move-out",
    description: "A complete clean to make a fresh start feel easy.",
    duration: "4 hours",
    priceCents: 18900,
  },
] as const;

export type ServiceId = (typeof SERVICES)[number]["id"];

export const TIME_SLOTS = ["09:00", "14:00"] as const;
export type BookingTime = (typeof TIME_SLOTS)[number];
