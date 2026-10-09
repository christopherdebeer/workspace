// Bits run bottom to top. The King Wen number is a lookup, never the binary value.
export const trigrams = [
  {bits:7,name:'Qián',image:'Heaven'}, {bits:3,name:'Duì',image:'Lake'},
  {bits:5,name:'Lí',image:'Fire'}, {bits:1,name:'Zhèn',image:'Thunder'},
  {bits:6,name:'Xùn',image:'Wind'}, {bits:2,name:'Kǎn',image:'Water'},
  {bits:4,name:'Gèn',image:'Mountain'}, {bits:0,name:'Kūn',image:'Earth'},
];
const kingWen = [
  [1,43,14,34,9,5,26,11], [10,58,38,54,61,60,41,19],
  [13,49,30,55,37,63,22,36], [25,17,21,51,42,3,27,24],
  [44,28,50,32,57,48,18,46], [6,47,64,40,59,29,4,7],
  [33,31,56,62,53,39,52,15], [12,45,35,16,20,8,23,2],
];
// English labels vary between editions. Reflection prompts below are original writing.
const entries = `乾|Qián|The Creative|What is ready to begin through your own initiative?
坤|Kūn|The Receptive|What could grow if you made room for it?
屯|Zhūn|Beginning|What small structure would help a fragile beginning take root?
蒙|Méng|Learning|Where would an honest question serve you better than an answer?
需|Xū|Waiting|What can you nourish while the conditions gather?
訟|Sòng|Conflict|What matters more here than winning the argument?
師|Shī|The Army|How could scattered effort become a shared purpose?
比|Bǐ|Holding Together|What makes this connection worth tending?
小畜|Xiǎo Xù|Small Restraint|Which small preparation is within reach today?
履|Lǚ|Treading|Where does your next step require particular care?
泰|Tài|Peace|What exchange is making this moment possible?
否|Pǐ|Standstill|What can you preserve while communication is difficult?
同人|Tóng Rén|Fellowship|What purpose could include people beyond your usual circle?
大有|Dà Yǒu|Great Possession|What responsibility comes with what you have?
謙|Qiān|Modesty|What would change if the work mattered more than recognition?
豫|Yù|Enthusiasm|How can energy become a steady commitment?
隨|Suí|Following|What are you choosing to follow, and why?
蠱|Gǔ|Repair|Which inherited habit needs your attention?
臨|Lín|Approach|How could you meet what is arriving with generosity?
觀|Guān|Contemplation|What becomes visible when you stop intervening?
噬嗑|Shì Kè|Biting Through|Which specific obstacle needs a clear decision?
賁|Bì|Grace|What does the surface reveal, and what does it conceal?
剝|Bō|Splitting Apart|What remains dependable as an old form falls away?
復|Fù|Return|Which modest return would put you back in touch with yourself?
無妄|Wú Wàng|Innocence|What would you do without trying to control the impression it makes?
大畜|Dà Xù|Great Restraint|What capacity needs time to mature before you use it?
頤|Yí|Nourishment|What are you feeding with your daily attention?
大過|Dà Guò|Great Excess|Where is the load greater than the structure can carry?
坎|Kǎn|Water|What steady practice helps you move through uncertainty?
離|Lí|Fire|What sustains the clarity you depend on?
咸|Xián|Influence|What moves you before you have words for it?
恆|Héng|Duration|What rhythm could last beyond this burst of effort?
遯|Dùn|Retreat|What space would a considered withdrawal create?
大壯|Dà Zhuàng|Great Power|Where would restraint make your strength more useful?
晉|Jìn|Progress|What deserves to become more visible now?
明夷|Míng Yí|Darkening of the Light|How can you protect what matters without displaying it?
家人|Jiā Rén|The Family|Which ordinary act would improve the life you share?
睽|Kuí|Opposition|What small agreement can coexist with real difference?
蹇|Jiǎn|Obstruction|Who or what could help you find another route?
解|Xiè|Release|What can you stop carrying now?
損|Sǔn|Decrease|What could be simpler without becoming poorer?
益|Yì|Increase|Where would a little generosity have a lasting effect?
夬|Guài|Breakthrough|What needs to be said plainly and without aggression?
姤|Gòu|Encounter|Which new influence deserves a conscious boundary?
萃|Cuì|Gathering|What would give this gathering a meaningful centre?
升|Shēng|Pushing Upward|What is the next small step in a longer growth?
困|Kùn|Exhaustion|What can sustain you when your usual resources are thin?
井|Jǐng|The Well|Which shared resource needs care rather than reinvention?
革|Gé|Revolution|What would make a necessary change trustworthy?
鼎|Dǐng|The Vessel|What could transform if it were held in a better form?
震|Zhèn|Thunder|After the surprise, what is still yours to choose?
艮|Gèn|Stillness|Where could you stop without abandoning what matters?
漸|Jiàn|Gradual Development|What needs to grow at its own pace?
歸妹|Guī Mèi|The Marrying Maiden|Which expectations need adjusting to the place you actually hold?
豐|Fēng|Abundance|What is worth appreciating while it is here?
旅|Lǚ|The Traveller|How can you move lightly through a place that is not yours?
巽|Xùn|Wind|What gentle action could become effective through repetition?
兌|Duì|Joy|What kind of exchange leaves both people more open?
渙|Huàn|Dispersion|What could soften a division that has become rigid?
節|Jié|Limitation|Which boundary would make freedom sustainable?
中孚|Zhōng Fú|Inner Truth|Where do your words and your conduct need to meet?
小過|Xiǎo Guò|Small Exceeding|Which small detail deserves more care than a grand gesture?
既濟|Jì Jì|After Completion|What needs tending even though the main work is done?
未濟|Wèi Jì|Before Completion|What final crossing calls for patience rather than haste?`;
export const hexagrams = entries.split('\n').map((row,i) => {
  const [han,pinyin,title,prompt] = row.split('|');
  const lowerIndex = kingWen.findIndex(r=>r.includes(i+1));
  const upperIndex = kingWen[lowerIndex].indexOf(i+1);
  const lower = trigrams[lowerIndex], upper = trigrams[upperIndex];
  return {number:i+1,han,pinyin,title,prompt,lower,upper,bits:lower.bits|(upper.bits<<3)};
});
export type Line = 6|7|8|9;
export const moving = (v:number) => v===6 || v===9;
export function identify(lines:Line[], relating=false) {
  const bits=lines.reduce((b,v,i)=>b|(((v%2) ^ (relating && moving(v)?1:0))<<i),0);
  return hexagrams.find(h=>h.bits===bits)!;
}

export function stableLines(number:number):Line[] {
  return Array.from({length:6},(_,i)=>(hexagrams[number-1].bits>>i)&1?7:8);
}
