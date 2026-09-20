import { v, type Infer } from "convex/values";
import { internalMutation } from "../_generated/server";

const seededDoc = v.object({ id: v.id("researchDocs"), url: v.string(), publisher: v.string() });

const FINDINGS = [
  {
    url: "https://www.nia.nih.gov/health/memory-loss-and-forgetfulness/memory-problems-forgetfulness-and-aging",
    publisher: "National Institute on Aging",
    excerpt:
      "Forgetfulness can be a normal part of aging. As people get older, changes occur in all parts of the body, including the brain, so some people may notice that it takes longer to learn new things, they do not remember information as well as they used to, or they lose things like their glasses. These are usually signs of mild forgetfulness, not a serious memory problem, but it is worth talking with a doctor when memory changes make daily life harder.",
    extractedFacts: [
      "Forgetfulness can be a normal part of aging",
      "Taking longer to learn new things, repeating a question or misplacing everyday items is often mild forgetfulness",
      "Talk with a doctor when memory changes make daily life harder",
    ],
  },
  {
    url: "https://www.nhs.uk/symptoms/memory-loss-amnesia/",
    publisher: "NHS",
    excerpt:
      "Memory loss can be a normal part of ageing, but it can also be a sign of a health condition such as depression, stress or dementia. See a GP if memory problems are affecting your daily life, or if they are getting worse rather than staying the same. Sudden memory loss or confusion that comes on quickly needs urgent medical help.",
    extractedFacts: [
      "See a GP if memory problems affect your daily life",
      "Memory loss can be a sign of depression, stress or dementia",
      "Sudden memory loss or confusion needs urgent medical help",
    ],
  },
  {
    url: "https://www.nia.nih.gov/health/medical-care-and-appointments/what-do-i-need-tell-doctor",
    publisher: "National Institute on Aging",
    excerpt:
      "Bringing a written list of your symptoms and questions to a medical appointment can help you get the most out of the visit. Note when a problem started, how often it happens, and anything that makes it better or worse. A family member or friend who knows you well can come along and fill in the details you might not notice.",
    extractedFacts: [
      "Bring a written list of symptoms and questions to the appointment",
      "Note when symptoms started, how often they happen, and what makes them better or worse",
      "A family member or friend can come along and fill in details",
    ],
  },
  {
    url: "https://www.mayoclinic.org/diseases-conditions/osteoarthritis/symptoms-causes/syc-20351925",
    publisher: "Mayo Clinic",
    excerpt:
      "Osteoarthritis is the most common form of arthritis, affecting millions of people worldwide. It occurs when the protective cartilage that cushions the ends of the bones wears down over time. Although osteoarthritis can damage any joint, the disorder most commonly affects joints in your hands, knees, hips and spine.",
    extractedFacts: [
      "Osteoarthritis occurs when the protective cartilage that cushions the bones wears down",
      "It most commonly affects joints in the hands, knees, hips and spine",
      "Joint pain, stiffness and swelling usually develop slowly and get worse over time",
    ],
  },
];

// TEMPORARY. Stands in for the #4 crawler output until that issue merges. The first
// three findings speak to the seeded subject's memory concern, and the Mayo Clinic
// row is the allowlisted but unrelated finding the matcher has to drop.
// `seed:seed` clears researchDocs, so it runs before this.
export const seedSyntheticDocs = internalMutation({
  args: {},
  returns: v.array(seededDoc),
  handler: async (ctx) => {
    const seeded: Infer<typeof seededDoc>[] = [];
    for (const [index, finding] of FINDINGS.entries()) {
      const id = await ctx.db.insert("researchDocs", {
        ...finding,
        fetchedAt: Date.now() - index * 60_000,
      });
      seeded.push({ id, url: finding.url, publisher: finding.publisher });
    }
    return seeded;
  },
});
