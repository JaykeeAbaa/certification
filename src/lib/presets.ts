import type { Design } from "./model";

export type EmailPreset = {
  id: string;
  name: string;
  blurb: string;
  design: Design;
};

function blocks(
  items: { type: Design["blocks"][number]["type"]; text: string; url?: string }[],
): Design["blocks"] {
  return items.map((b, i) => ({
    id: String(i + 1),
    type: b.type,
    text: b.text,
    url: b.url || "",
  }));
}

export const emailPresets: EmailPreset[] = [
  {
    id: "preset-formal",
    name: "Formal Serif",
    blurb: "Centered Georgia serif for official ceremonies.",
    design: {
      color: "#1e3a5f",
      background: "#ffffff",
      font: "Georgia",
      align: "center",
      spacing: 32,
      blocks: blocks([
        { type: "heading", text: "Certificate of Completion" },
        {
          type: "text",
          text: "Dear **{{name}}**,\n\nIt is our honor to recognize your successful completion of *{{training_title}}* held on {{training_date}}.",
        },
        { type: "divider", text: "" },
        {
          type: "text",
          text: "Your signed certificate is attached to this email. Thank you for learning with us.",
        },
        {
          type: "button",
          text: "Explore more opportunities",
          url: "https://dict.gov.ph",
        },
        {
          type: "text",
          text: "With appreciation,\n**{{organizer}}**\nDepartment of Information and Communications Technology",
        },
      ]),
    },
  },
  {
    id: "preset-modern",
    name: "Modern Minimal",
    blurb: "Left-aligned Trebuchet with breathing room.",
    design: {
      color: "#164dce",
      background: "#ffffff",
      font: "Trebuchet MS",
      align: "left",
      spacing: 40,
      blocks: blocks([
        { type: "heading", text: "A new milestone. Well earned." },
        {
          type: "text",
          text: "Hi **{{name}}**,\n\nCongratulations on completing *{{training_title}}* ({{training_date}})! Thank you for learning with us and taking another step toward a digitally empowered Philippines.",
        },
        {
          type: "button",
          text: "View upcoming trainings",
          url: "https://dict.gov.ph",
        },
        { type: "divider", text: "" },
        { type: "text", text: "{{organizer}}" },
      ]),
    },
  },
  {
    id: "preset-warm",
    name: "Warm Congratulatory",
    blurb: "Friendly Verdana tone for community trainings.",
    design: {
      color: "#0f766e",
      background: "#ffffff",
      font: "Verdana",
      align: "center",
      spacing: 32,
      blocks: blocks([
        { type: "heading", text: "Congratulations, **{{name}}**!" },
        {
          type: "text",
          text: "You did it! You have successfully finished *{{training_title}}* last {{training_date}}.\n\nYour signed certificate is attached — wear that achievement proudly.",
        },
        { type: "divider", text: "" },
        { type: "text", text: "With appreciation,\n**{{organizer}}**" },
      ]),
    },
  },
];
