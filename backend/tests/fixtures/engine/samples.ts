// Fixed sample story outputs for the BE-09 engine tests (guide: "run in CI on fixed sample
// outputs with no live AI calls"). The GOOD samples follow every rule; each test makes one
// known-bad copy by breaking exactly one thing.
import type { DraftPanel, StoryAnswers } from "../../../src/engine/index.js";

export const EMBER_ANSWERS: StoryAnswers = {
  storyPath: "three_act",
  mode: "junior",
  heroType: "fox",
  charName: "Ember",
  heroPronoun: "she",
  charTools: ["glasses"],
  charStrengths: ["kind-heart"],
  selfLove: "being kind",
  oneMoreAmazingThing: "she can whistle like a kettle",
  aspiration: "be a vet",
  obstacles: ["grumpy-giant"],
  obstacles2: ["glass-wall"],
  obstacles3: ["roaring-fire"],
  heartColor: "jumpy",
  heartColor2: "foggy",
  heartColor3: "steady",
  braveMove: "ask-for-help",
  braveMove2: "lead-the-way",
  braveMove3: "deep-breaths",
  heroWords: "I can start with one small step.",
  heroWords2: "I'll try another way.",
  heroWords3: "I can keep going one step at a time.",
  safePlaceText: "the tree house",
  thirdChallengeText: "",
};

export const EMBER_TWO_ACT: StoryAnswers = {
  ...EMBER_ANSWERS,
  storyPath: "two_act",
  obstacles3: [],
  heartColor3: "",
  braveMove3: "",
  heroWords3: "",
};

const PANEL_5_BEATS = [
  "At the gate of the animal clinic, the Grumpy Giant stomped onto the path and folded his enormous arms.",
  '"You are a wall made of thunder," Ember whispered.',
  "Her tail bristled and her paws felt heavy on the cold stones.",
  'She lifted her chin and called out, "I can start with one small step."',
  "The Giant did not move an inch, and a gust of his grumbling breath pushed her back into the mud.",
  "Ember pushed her glasses up her nose and remembered her kind heart.",
  "She waved to her friend Pip the puppy, and together they took one careful step toward the gate.",
  "The Giant grumbled and shuffled half a step aside, still huge, still there, but now there was a narrow way past him.",
];

const PANEL_9_BEATS = [
  "Inside the clinic, a Glass Wall rose up between Ember and the room full of sleepy animals.",
  '"You are a window that will not open," she said softly.',
  "Her tail bristled and her ears pressed flat.",
  'Ember stood tall in front of the other helpers and said, "I\'ll try another way."',
  "She pressed her paw against the cold glass, and her reflection only stared back at her.",
  "She breathed in the warm smell of hay and remembered how the Giant had stepped aside.",
  "This time she led the little group slowly along the wall, looking for the place where the glass met the old wooden door.",
  "The wall still stood, clear and cold, but she could now see a small latch near the floor.",
];

export const EMBER_THREE_ACT: DraftPanel[] = [
  { number: 1, text: "Ember was a clever young fox with a golden tail who lived beside a busy animal clinic." },
  { number: 2, text: "Ember had a kind heart, and her round glasses helped her notice every tiny paw print. 'Maybe I can help them all,' Ember thought." },
  { number: 3, text: "Each morning she watched the vet listen to a puppy with a shiny stethoscope, and she dreamed of doing the same." },
  { number: 4, text: "One day a Grumpy Giant sat right in front of the clinic gate and refused to let anyone through." },
  { number: 5, beats: PANEL_5_BEATS },
  { number: 6, text: "Ember felt jumpy and small. Her heart thumped, and part of her wanted to run home, but she stayed." },
  { number: 7, text: "That evening she curled up in the tree house, listened to the leaves, and let her strength slowly return." },
  { number: 8, text: "The next day, a Glass Wall appeared inside the clinic, blocking the way to the animals who needed care." },
  { number: 9, beats: PANEL_9_BEATS },
  { number: 10, text: "It took many tries. Ember tested each corner of the wall, rested, and tried again, one patient paw at a time." },
  { number: 11, text: "At last she stood beside the kitten beds in the clinic and saw how far her small steps had carried her." },
  { number: 12, text: 'Then a Roaring Fire of worry flared in front of the last kennel, and Ember sat down, very tired. Softly she said, "I can keep going one step at a time."' },
  { number: 13, text: "Remembering that promise to herself, Ember breathed slowly three times, letting each breath carry her a little further past the flames." },
  { number: 14, text: "In the warm clinic, surrounded by animals she had helped, Ember took her next brave step toward becoming the vet." },
  { number: 15, text: "Whenever something hard stands in your way, you can choose one small brave step, just like Ember. One real step today." },
];

// Two acts: panels 1–10, then the Grand Finale and the Practice Anchor as 11 and 12.
export const EMBER_TWO_ACT_DRAFT: DraftPanel[] = [
  ...EMBER_THREE_ACT.slice(0, 10),
  { ...EMBER_THREE_ACT[13], number: 11 },
  { ...EMBER_THREE_ACT[14], number: 12 },
];

/** A deep copy to break one thing in. */
export function copyOf(draft: DraftPanel[]): DraftPanel[] {
  return draft.map((p) => ({ ...p, ...(p.beats && { beats: [...p.beats] }) }));
}

export function panel(draft: DraftPanel[], number: number): DraftPanel {
  return draft.find((p) => p.number === number)!;
}
