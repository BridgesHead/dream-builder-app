// BE-14: what the anonymising gate takes out of every AI request (pure logic).
import { describe, expect, it } from "vitest";
import { anonymise, findLeaks, GROWN_UP, nameParts, NO_FAMILY, type FamilyDetails } from "../../src/ai/anonymise.js";
import { aiNameFor, STAND_IN } from "../../src/ai/prompts.js";

const AISHA: FamilyDetails = {
  childNames: ["Aisha Rahman"],
  grownUpNames: ["Mariam Rahman"],
  authorNames: ["Aisha R."],
  emails: ["mariam.rahman@example.com"],
  phones: ["+971 50 123 4567"],
  addressLines: ["Villa 12, Al Wasl Road"],
};

const clean = (text: string, alias = "Sparkle") => anonymise(text, AISHA, alias);

describe("known family details", () => {
  it("the child's name becomes the hero's name; the parent's becomes 'a grown-up'", () => {
    expect(clean("Aisha wants to be a vet.")).toBe("Sparkle wants to be a vet.");
    expect(clean("aisha rahman's dream")).toBe("Sparkle's dream");
    expect(clean("I asked Mariam for help.")).toBe(`I asked ${GROWN_UP} for help.`);
    // The shared family name goes as a grown-up's, never turned into the hero.
    expect(clean("The Rahman family")).toBe(`The ${GROWN_UP} family`);
  });

  it("the email, the phone (however it's spaced) and the address are removed", () => {
    for (const phone of ["+971 50 123 4567", "+971501234567", "971-50-123-4567"]) {
      expect(clean(`call mum on ${phone} please`)).toBe("call mum on please");
    }
    expect(clean("write to mariam.rahman@example.com")).toBe("write to");
    expect(clean("I live at Villa 12, Al Wasl Road, Dubai")).not.toMatch(/Villa|Wasl/);
  });

  it("only whole words: 'Aishara' and 'Rahmania' are left alone", () => {
    expect(clean("Aishara met Rahmania.")).toBe("Aishara met Rahmania.");
  });

  it("small name words that are everyday words are kept ('bin', 'al')", () => {
    expect(nameParts(["Ahmed bin Rashid Al Maktoum"])).toEqual(["Ahmed bin Rashid Al Maktoum", "Maktoum", "Rashid", "Ahmed"]);
    expect(anonymise("put it in the bin", { ...NO_FAMILY, grownUpNames: ["Ahmed bin Rashid"] }, "Tibbo")).toBe("put it in the bin");
  });
});

describe("patterns (things we can't know in advance)", () => {
  it.each([
    ["my email is aisha.r@gmail.com", "my email is"],
    ["call 050-1234567 now", "call now"],
    ["see www.aisha-world.ae for more", "see for more"],
    ["see https://example.org/a?b=1 now", "see now"],
    ["P.O. Box 1234 is ours", "is ours"],
    ["we live in Flat 3B near the park", "we live in near the park"],
  ])("%j → %j", (input, output) => {
    expect(anonymise(input, NO_FAMILY, STAND_IN)).toBe(output);
  });

  it("a school's name becomes 'school'; 'my school' is kept", () => {
    expect(anonymise("I go to Al Noor Primary School every day", NO_FAMILY, STAND_IN)).toBe("I go to school every day");
    expect(anonymise("Dubai International Academy is big", NO_FAMILY, STAND_IN)).toBe("school is big");
    expect(anonymise("I love my school", NO_FAMILY, STAND_IN)).toBe("I love my school");
  });

  it("story words and small numbers are untouched", () => {
    const story = 'Panel 12: Sparkle climbed 3 hills in 2026, feeling brave. "I can do this!"';
    expect(anonymise(story, NO_FAMILY, "Sparkle")).toBe(story);
  });
});

describe("the leak check", () => {
  it("finds what's left (the kinds only, never the details)", () => {
    const leaks = findLeaks("Aisha, Mariam, mariam.rahman@example.com, 050 123 4567, www.x.com", AISHA, "Sparkle");
    expect(leaks.sort()).toEqual(["a grown-up's name", "a link", "a phone number", "an email address", "the child's name"]);
    expect(leaks.join(" ")).not.toMatch(/Aisha|Mariam|050/);
  });

  it("nothing left after cleaning", () => {
    const dirty = "Aisha Rahman (mum Mariam, +971 50 123 4567, mariam.rahman@example.com) at Al Noor Primary School";
    expect(findLeaks(clean(dirty), AISHA, "Sparkle")).toEqual([]);
  });

  it("the hero's alias is not a leak", () => {
    expect(findLeaks("Sparkle smiled.", AISHA, "Sparkle")).toEqual([]);
  });
});

describe("the name the AI sees", () => {
  it("the real hero name, when it isn't a family name", () => {
    expect(aiNameFor("Sparkle", AISHA)).toBe("Sparkle");
  });
  it("the stand-in, when the hero is named after the family, or the family is unknown", () => {
    expect(aiNameFor("Aisha", AISHA)).toBe(STAND_IN);
    expect(aiNameFor("Captain Rahman", AISHA)).toBe(STAND_IN);
    expect(aiNameFor("Sparkle", NO_FAMILY)).toBe(STAND_IN);
  });
});
