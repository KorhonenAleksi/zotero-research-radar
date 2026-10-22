# Research Radar: AI setup prompt

<!-- Generated from src/core/aiSetupPrompt.ts by `npm run docs:prompt`. Do not edit by hand. -->

Use this to draft your journal list, keyword rules and watched authors from your own notes with an AI assistant that can read a folder (for example Claude Cowork):

1. Give the assistant access to the folder with your research notes (e.g. your Obsidian vault).
2. Paste the prompt below. The same text is available in Zotero under **Settings → Research Radar → Copy setup prompt**.
3. Review the notes file it writes, then import `research-radar-profile.json` under **Settings → Research Radar → Import profile…**. You will see a preview first; importing only adds to your settings.

Your notes are read by the assistant you choose, under that service's terms. Research Radar itself never reads your notes or sends them anywhere.

---

You are helping me set up Research Radar, a Zotero plugin that watches journals for new articles and ranks them with keyword rules. Please read my research notes in the folder I have given you access to and draft a Research Radar profile for me.

## 1. What to read, and privacy

- Read only notes about my research: project and paper notes, literature notes, reading notes, drafts, research plans, maps of content, tags. Skip folders or notes that look personal (diary, daily notes, health, finances, people/contacts, meeting notes about individuals). If unsure, skip.
- Do not change, move or delete anything in the folder. Only create the two output files described below.
- The output must not quote my notes. Short note titles are fine when explaining your choices; passages of text are not.

## 2. Work out my research profile

Identify my main research themes, the questions I keep returning to, the methods I use, the periods, places and industries I study, and the authors and journals I cite most. Prefer what recurs across many notes over one-off mentions.

## 3. Journals (aim for 15-40)

Choose journals where new work relevant to me is likely to appear: those I cite most, plus close neighbours. Include general journals only if they regularly publish in my areas.

For every journal give its print and/or electronic ISSN. Do not guess ISSNs. If you can access the web, verify each one at https://api.crossref.org/journals/ISSN (for example https://api.crossref.org/journals/0007-6791) and check that the returned title is the journal you mean; several journals share names. If you cannot verify an ISSN, leave it out and say so in the notes file. Add an RSS feed URL only if you have checked that it works; it is optional.

## 4. Keyword rules (aim for 8-20)

Rules are matched against each new article's title and abstract. Many publishers send no abstract, so most matches will come from titles: favour words that would appear in a title. The syntax is exact; follow it carefully:

- Words match in any grammatical form ("decline" also finds "declining", "declines"). British and American spellings match each other, and accents are ignored.
- Put phrases in double quotes: "organizational decline". Unquoted words next to each other must all appear, in any order.
- Use OR, AND and NOT in capital letters. Lower-case "and"/"or" are treated as ordinary words that must appear.
- Use brackets to group: (decline OR failure) AND firm*
- A trailing * matches word families: histor* finds history, historical, historiography. It needs at least 3 letters before the *.
- Each rule has a weight. A title match scores 3 x the weight, an abstract match 1 x the weight. 1 point or more puts an article in "Possible"; 5 or more in "High". Use weight 2 for my core themes (one title match then gives High) and 1 for peripheral ones.
- An exclusion rule ("exclude": true, weight 0) hides matching articles (they stay viewable). Use it only for clear noise, for example a field that shares my vocabulary but is not mine.

Prefer several focused rules, each with a short label, over one long rule. Avoid single very common words (strategy, management, firm) on their own; they match almost everything.

## 5. Authors to watch (optional, up to 15)

People whose new work I would always want to see, judged from how often and how centrally I cite them. Give family and given names. Include an ORCID iD only if you have verified it on orcid.org; never guess one. Weight 5 puts every new paper by them in "High".

## 6. Interests paragraph

Write 3-6 sentences describing my research interests in plain language, as a colleague would. This will later be used by the plugin's optional AI ranking.

## 7. Output

Create two files in the root of the folder:

1. research-radar-profile.json, exactly in this format (JSON only, no comments):

{
  "format": "research-radar-profile",
  "version": 1,
  "interests": "3-6 sentences...",
  "journals": [
    { "title": "Business History", "issnPrint": "0007-6791", "issnElectronic": "1743-7938", "feedUrl": "", "why": "Most-cited journal in my notes" }
  ],
  "rules": [
    { "label": "Decline", "query": "\"organizational decline\" OR \"corporate failure\" OR turnaround*", "weight": 2, "exclude": false, "why": "Core theme of my project notes" }
  ],
  "authors": [
    { "family": "Chandler", "given": "Alfred", "orcid": "", "weight": 5, "why": "Cited throughout" }
  ]
}

2. research-radar-profile-notes.md: a short, readable explanation for me. List the themes you found and, for each journal, rule and author, one line on why you chose it (you may name the notes that led to it). Also list anything you were unsure about or could not verify.

I will import the JSON in Zotero under Settings > Research Radar > Import profile. The import shows a preview first and only adds to what I already have.
