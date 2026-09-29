/**
 * The in-lab eval: a 15-question sample of mixed kinds drawn from the dev set
 * (31) and two held-out sets (16 + 14) the engine was measured on — sized so a
 * run costs a few M tokens, not half the daily Jev budget.
 */
export const EVALSET: Array<[string, string[]]> = [
  ["Who invented the telephone?", ["alexander graham bell", "graham bell", "bell"]],
  ["Who painted the Mona Lisa?", ["leonardo da vinci", "da vinci", "leonardo"]],
  ["In what year did the Berlin Wall fall?", ["1989"]],
  ["What gas do plants absorb from the air?", ["carbon dioxide", "co2"]],
  ["Who wrote Pride and Prejudice?", ["jane austen", "austen"]],
  ["Who painted the Sistine Chapel ceiling?", ["michelangelo", "michelangelo buonarroti"]],
  ["What is the fastest land animal?", ["cheetah", "the cheetah"]],
  ["How many minutes are in a day?", ["1440"]],
  ["Can penguins fly?", ["no"]],
  ["Who wrote The Odyssey?", ["homer"]],
  ["What is the main ingredient in guacamole?", ["avocado", "avocados"]],
  ["How many bones are in the adult human body?", ["206"]],
  ["What is the largest mammal?", ["blue whale", "the blue whale", "whale"]],
  ["Who was the Greek god of the sea?", ["poseidon"]],
  ["What is the capital of Australia?", ["canberra"]],
];
