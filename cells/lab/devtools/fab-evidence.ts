import {sewnTest,cusick,patternTest,garmentTest} from '../client/fab/evidence';
console.log(JSON.stringify({pattern:patternTest(30).pass,garments:garmentTest(30).pass,sewn:sewnTest(),drape:cusick()},null,2));
