import { describe, it, expect } from "vitest";
import {
  normalizeSex,
  normalizeName,
  normalizeSector,
  nameKey,
  detectColumns,
  analyzeRows,
  keepFirstIndices,
} from "../src/lib/data-analysis";

describe("data analysis engine", () => {
  it("normalizes sex values including Filipino terms and single letters", () => {
    expect(normalizeSex("Male")).toBe("male");
    expect(normalizeSex(" M ")).toBe("male");
    expect(normalizeSex("LALAKI")).toBe("male");
    expect(normalizeSex("f")).toBe("female");
    expect(normalizeSex("Babae")).toBe("female");
    expect(normalizeSex("Female")).toBe("female");
    expect(normalizeSex("")).toBe("unspecified");
    expect(normalizeSex("Other")).toBe("unspecified");
    expect(normalizeSex("non-binary")).toBe("unspecified");
  });

  it("normalizes names so near-duplicates match", () => {
    expect(normalizeName("  Juan  Dela Cruz ")).toBe("juan dela cruz");
    expect(normalizeName("JuAn Dela-Cruz")).toBe("juan dela cruz");
    expect(normalizeName("María Peña")).toBe("maria pena");
  });

  it("keys duplicates by first + last name, ignoring middles and suffixes", () => {
    expect(nameKey("Juan Dela Cruz")).toBe("juan cruz");
    expect(nameKey("Juan D. Cruz")).toBe("juan cruz");
    expect(nameKey("Juan Dela Cruz Jr")).toBe("juan cruz");
    expect(nameKey("JUAN CRUZ")).toBe("juan cruz");
    expect(nameKey("Madonna")).toBe("madonna");
    expect(nameKey("")).toBe("");
    const result = analyzeRows(
      [
        { name: "Juan Dela Cruz", sex: "M", email: "a@example.com" },
        { name: "Juan D. Cruz", sex: "Male", email: "b@example.com" },
        { name: "Maria Santos", sex: "F", email: "c@example.com" },
      ],
      { name: "name", sex: "sex", email: "email", sector: "sector" },
    );
    const nameGroups = result.groups.filter((g) => g.kind === "name");
    expect(nameGroups.length).toBe(1);
    expect(nameGroups[0].rows).toEqual([0, 1]);
    expect(keepFirstIndices(result.groups)).toEqual(new Set([1]));
    expect(keepFirstIndices(result.groups, ["row"])).toEqual(new Set());
  });
  it("detects name, sex, and email columns", () => {
    expect(detectColumns(["fullname", "Sex", "EmailAddress", "age"])).toEqual({
      name: "fullname",
      sex: "Sex",
      email: "EmailAddress",
      sector: "",
    });
    expect(detectColumns(["participant_name", "kasarian"])).toEqual({
      name: "participant_name",
      sex: "kasarian",
      email: "",
      sector: "",
    });
    expect(detectColumns(["name", "Sector", "email"])).toEqual({
      name: "name",
      sex: "",
      email: "email",
      sector: "Sector",
    });
  });

  it("normalizes sectors to canonical groups", () => {
    expect(normalizeSector("PWD")).toBe("pwd");
    expect(normalizeSector("person with disability")).toBe("pwd");
    expect(normalizeSector("OSY")).toBe("osy");
    expect(normalizeSector("Out-of-School Youth")).toBe("osy");
    expect(normalizeSector("Student")).toBe("student");
    expect(normalizeSector("Senior High Student")).toBe("student");
    expect(normalizeSector("IP")).toBe("ip");
    expect(normalizeSector("Indigenous Peoples")).toBe("ip");
    expect(normalizeSector("Teacher")).toBe("teacher");
    expect(normalizeSector("Educators")).toBe("teacher");
    expect(normalizeSector("Senior Citizen")).toBe("senior");
    expect(normalizeSector("")).toBe("unspecified");
    expect(normalizeSector("4Ps")).toBe("other");
  });

  it("counts sectors per category", () => {
    const rows = [
      { name: "A", sector: "PWD" },
      { name: "B", sector: "Student" },
      { name: "C", sector: "student" },
      { name: "D", sector: "Senior Citizen" },
      { name: "E", sector: "Out of School Youth" },
      { name: "F", sector: "IP" },
      { name: "G", sector: "Teacher" },
      { name: "H", sector: "" },
    ];
    const result = analyzeRows(rows, { name: "name", sex: "", email: "", sector: "sector" });
    expect(result.sectors).toEqual({
      pwd: 1,
      osy: 1,
      student: 2,
      ip: 1,
      teacher: 1,
      senior: 1,
      other: 0,
      unspecified: 1,
    });
  });

  it("counts accurately and flags duplicates and bad rows", () => {
    const rows = [
      { name: "Alex Santos", sex: "Male", email: "alex@example.com" },
      { name: "alex  santos", sex: "M", email: "alex2@example.com" },
      { name: "Jamie Reyes", sex: "Babae", email: "jamie@example.com" },
      { name: "Jamie Reyes", sex: "F", email: "jamie@example.com" },
      { name: "Sam Lee", sex: "", email: "not-an-email" },
      { name: "", sex: "Male", email: "noname@example.com" },
    ];
    const result = analyzeRows(rows, { name: "name", sex: "sex", email: "email", sector: "" });
    expect(result.total).toBe(6);
    expect(result.male).toBe(3);
    expect(result.female).toBe(2);
    expect(result.unspecified).toBe(1);
    expect(result.groups.some((g) => g.kind === "name" && g.rows.length === 2)).toBe(true);
    expect(result.groups.some((g) => g.kind === "email" && g.label === "jamie@example.com")).toBe(true);
    expect(result.exactDuplicates).toBe(2);
    expect(result.rows[4].flags).toContain("invalid-email");
    expect(result.rows[5].flags).toContain("missing-name");
    expect(result.duplicateRows).toBe(4);
  });

  it("handles missing columns without crashing", () => {
    const result = analyzeRows([{ foo: "bar" }], { name: "", sex: "", email: "", sector: "" });
    expect(result.total).toBe(1);
    expect(result.unspecified).toBe(1);
    expect(result.groups).toEqual([]);
  });
});
