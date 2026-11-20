import { describe, expect, it } from 'vitest';
import {
  countListings,
  getSection,
  parseDestinationList,
  parseRegionTitles,
  parseSleepListings,
  parseTemplates,
  stripMarkup,
} from './wikitext';

const COUNTRY = `Intro text
==Regions==
{{mapshape|type=geoshape|title=[[Akershus]]|wikidata=Q50615|fill=#71B37B}}
{{mapshape|type=geoshape|title=[[Oslo]]|wikidata=Q585}}
==Cities==
<!-- comment -->
* {{marker|type=city|name=[[Oslo]]|url=|lat=59.95|long=10.75|wikidata=Q585}} – The capital, with [[museum]]s and nightlife.
* {{marker|type=city|name=[[Bergen (Norway)|Bergen]]|lat=60.38|long=5.33}} – Gateway to the fjords.
* [[Tromsø]] — Arctic city with northern lights.
==Other destinations==
* {{marker|type=vicinity|name=[[Lofoten]]|lat=68.33|long=14.67|wikidata=Q186822}} – Islands and mountains.
===Sub===
not a list item
==Understand==
text`;

describe('wikitext', () => {
  it('findet Abschnitte der Ebene 2 inkl. Unterabschnitten', () => {
    const s = getSection(COUNTRY, ['Other destinations'])!;
    expect(s).toContain('Lofoten');
    expect(s).toContain('===Sub===');
    expect(s).not.toContain('Understand');
    expect(getSection(COUNTRY, ['Nope'])).toBeNull();
  });

  it('parst Ziel-Listen mit und ohne marker-Vorlage', () => {
    const items = parseDestinationList(getSection(COUNTRY, ['Cities'])!);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ title: 'Oslo', lat: 59.95, lon: 10.75, wikidata: 'Q585' });
    expect(items[0].description).toBe('The capital, with museums and nightlife.');
    expect(items[1].title).toBe('Bergen (Norway)');
    expect(items[2]).toMatchObject({ title: 'Tromsø', description: 'Arctic city with northern lights.' });
    expect(items[2].lat).toBeUndefined();
  });

  it('liest Unterregionen', () => {
    expect(parseRegionTitles(getSection(COUNTRY, ['Regions'])!)).toEqual(['Akershus', 'Oslo']);
  });

  it('parst verschachtelte Vorlagen', () => {
    const [t] = parseTemplates('x {{see|name=A {{!}} B|content=Has [[Link|text]] and {{km|3}}|lat=1}} y');
    expect(t.name).toBe('see');
    expect(t.params.content).toBe('Has [[Link|text]] and {{km|3}}');
    expect(t.params.lat).toBe('1');
  });

  it('entfernt Markup', () => {
    expect(stripMarkup("'''Bold''' [[A|b]] [[C]] {{x|y}}<ref>r</ref> &nbsp;z")).toBe('Bold b C z');
  });

  it('zählt Sehenswürdigkeiten und Unterkünfte', () => {
    const city = `==See==
* {{see|name=Museum|lat=1|long=2}}
* {{listing|name=Park}}
==Do==
* {{do|name=Hike}}
==Sleep==
===Budget===
* {{sleep|name=Happy Hostel|price=Dorm 20 €|url=http://hostel.example|lat=1.5|long=2.5|content=Nice}}
===Splurge===
* {{sleep|name=Grand Hotel|url=www.no-protocol}}
==Go next==`;
    expect(countListings(city)).toEqual({ see: 2, do: 1 });
    const sleep = parseSleepListings(city);
    expect(sleep).toHaveLength(2);
    expect(sleep[0]).toMatchObject({
      name: 'Happy Hostel',
      category: 'budget',
      price: 'Dorm 20 €',
      url: 'http://hostel.example',
      lat: 1.5,
      lon: 2.5,
    });
    expect(sleep[1]).toMatchObject({ name: 'Grand Hotel', category: 'splurge', url: undefined });
  });
});
