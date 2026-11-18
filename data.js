// Sample data. Names, addresses and reviews are invented for demonstration.
window.LANDLORDS = [
  { id: 'harlow', name: 'Harlow Property Group', type: 'Management company', city: 'Los Angeles', state: 'CA',
    properties: ['2210 Sunset Terrace', '418 W Alvarado Ave', '77 Echo Park Blvd'] },
  { id: 'delano', name: 'Marcus Delano', type: 'Individual owner', city: 'Austin', state: 'TX',
    properties: ['905 E 11th St', '1412 Rosewood Ave'] },
  { id: 'brightwater', name: 'Brightwater Residential', type: 'Management company', city: 'Chicago', state: 'IL',
    properties: ['3340 N Lakeview Ave', '1620 W Fullerton Pkwy'] },
  { id: 'pineash', name: 'Pine & Ash Rentals', type: 'Small portfolio', city: 'Portland', state: 'OR',
    properties: ['2815 SE Division St', '640 NE Alberta St'] },
  { id: 'calloway', name: 'Calloway Holdings LLC', type: 'Management company', city: 'Brooklyn', state: 'NY',
    properties: ['188 Bedford Ave', '52 Nostrand Ave'] },
  { id: 'voss', name: 'Eleni Voss', type: 'Individual owner', city: 'Boston', state: 'MA',
    properties: ['31 Chester St', '9 Linden Park'] },
  { id: 'summit', name: 'Summit Row Management', type: 'Management company', city: 'Denver', state: 'CO',
    properties: ['1450 Larimer St', '2290 S Pearl St', '801 Washington St'] }
];

// [landlord, property, year, overall, responsiveness, repairs, deposit, wouldRentAgain, tags, text, landlordResponse]
// deposit: full | partial | withheld | living | na
window.REVIEWS = [
  ['harlow','2210 Sunset Terrace',2026,1,1,1,'withheld',false,['Slow repairs','Deposit withheld','Mold'],
   'Black mold in the bathroom ceiling for eight months. I sent twelve emails and three certified letters. They finally sent someone to paint over it. At move-out they kept the full $2,400 deposit for "cleaning" and sent no itemized list.', null],
  ['harlow','418 W Alvarado Ave',2025,2,1,2,'partial',false,['Slow repairs','Unreachable'],
   'Heater broke in December and stayed broken until February. Nobody picks up the maintenance line. Do not sign here if you need heat.', null],
  ['harlow','2210 Sunset Terrace',2025,1,2,1,'withheld',false,['Deposit withheld','Entry without notice'],
   'Maintenance walked into my unit twice without any notice. Deposit was never returned. I had to go to small claims.', 'We take every tenant concern seriously. Please contact our office so we can review your file.'],
  ['harlow','77 Echo Park Blvd',2024,3,2,3,'full',false,['Rent hikes'],
   'The apartment itself was fine but rent went up 14% at renewal with thirty days of warning. Got my deposit back on time.', null],
  ['harlow','418 W Alvarado Ave',2024,2,2,2,'partial',false,['Pest issues','Slow repairs'],
   'Roaches in the kitchen the whole year. Pest control came once and never followed up.', null],

  ['delano','905 E 11th St',2026,5,5,5,'full',true,['Quick fixes','Respectful','Fair lease'],
   'Marcus fixed a leaking faucet the same afternoon I texted him. The lease was plain English and he gave me the full deposit back within a week of moving out.', 'Thanks Jordan, you were a great tenant.'],
  ['delano','1412 Rosewood Ave',2025,4,4,5,'full',true,['Respectful','Quick fixes'],
   'Responsive and fair. He is a little slow to reply on weekends but anything urgent was handled fast.', null],
  ['delano','905 E 11th St',2024,5,5,4,'full',true,['Respectful','Fair lease'],
   'Gave proper notice every time he needed to come by. Renewed for a second year with only a small increase.', null],
  ['delano','1412 Rosewood Ave',2023,4,3,4,'full',true,['Fair lease'],
   'Honest guy. Old building so there were small issues, but he always showed up.', null],

  ['brightwater','3340 N Lakeview Ave',2026,3,2,4,'partial',true,['Rent hikes','Fair lease'],
   'Repairs get done but the office is slow to answer. They deducted $300 for carpet that was already worn when I moved in.', null],
  ['brightwater','1620 W Fullerton Pkwy',2025,4,4,4,'full',true,['Quick fixes'],
   'Online portal makes requests easy. Most are handled in two or three days.', null],
  ['brightwater','3340 N Lakeview Ave',2025,2,2,3,'partial',false,['Hidden fees','Rent hikes'],
   'Surprise "amenity fee" appeared on month four. The lease mentioned it in fine print.', 'The amenity fee is described in section 14 of the lease. Happy to walk through it.'],
  ['brightwater','1620 W Fullerton Pkwy',2024,3,3,3,'full',true,['Fair lease'],
   'Middle of the road. Nothing terrible, nothing special.', null],

  ['pineash','2815 SE Division St',2026,5,5,5,'living',true,['Respectful','Quick fixes','Fair lease'],
   'Two owners who actually live nearby. Fixed our dishwasher in a day and sent a note when the water would be shut off.', null],
  ['pineash','640 NE Alberta St',2025,5,4,5,'full',true,['Respectful'],
   'Deposit back in six days with a clear breakdown. Would rent again without thinking about it.', null],
  ['pineash','2815 SE Division St',2024,4,4,4,'full',true,['Fair lease','Quick fixes'],
   'Small portfolio, personal service. Rent is a bit above market but you get what you pay for.', null],
  ['pineash','640 NE Alberta St',2023,4,5,4,'full',true,['Respectful'],
   'Answered every message the same day.', null],

  ['calloway','188 Bedford Ave',2026,1,1,1,'withheld',false,['Slow repairs','Deposit withheld','Harassment'],
   'They stopped fixing things when I would not agree to a rent increase mid-lease. No hot water for nineteen days. Deposit gone.', null],
  ['calloway','52 Nostrand Ave',2026,1,1,1,'living',false,['Pest issues','Unreachable','Mold'],
   'Mice, mold and a ceiling leak that came back three times. Super does not respond.', null],
  ['calloway','188 Bedford Ave',2025,1,2,1,'withheld',false,['Entry without notice','Harassment'],
   'Repeated knocks and entries without notice. Felt like they wanted us out.', 'These claims are inaccurate. We follow all applicable housing laws.'],
  ['calloway','52 Nostrand Ave',2025,2,1,2,'partial',false,['Slow repairs','Hidden fees'],
   'Charged for "turnover" costs that are not legal in my state.', null],
  ['calloway','188 Bedford Ave',2024,1,1,2,'withheld',false,['Deposit withheld'],
   'Never again.', null],

  ['voss','31 Chester St',2026,5,5,5,'full',true,['Respectful','Quick fixes','Fair lease'],
   'Eleni treated the apartment like a home, not a unit. Called to check in after the first cold snap and replaced the old radiator valve without being asked.', null],
  ['voss','9 Linden Park',2025,5,5,4,'full',true,['Respectful','Fair lease'],
   'Got our deposit back plus a handwritten note. Best landlord I have had in ten years of renting.', null],
  ['voss','31 Chester St',2024,4,5,4,'full',true,['Respectful'],
   'Always gave advance notice. Rent held steady for two years.', null],

  ['summit','1450 Larimer St',2026,2,2,2,'partial',false,['Slow repairs','Hidden fees'],
   'Elevator out for six weeks. Parking fees tripled with one month of notice.', null],
  ['summit','2290 S Pearl St',2025,3,3,3,'full',false,['Rent hikes'],
   'Okay unit, high rent, forgettable management. Deposit came back on time.', null],
  ['summit','801 Washington St',2025,1,1,2,'withheld',false,['Deposit withheld','Unreachable'],
   'Took 70 days to answer about my deposit and kept half of it for normal wear.', null],
  ['summit','1450 Larimer St',2024,3,2,3,'partial',false,['Hidden fees'],
   'Fees on top of fees. The unit is decent.', 'We have updated our fee disclosures. Thank you for the feedback.']
];

window.TAGS = ['Quick fixes','Respectful','Fair lease','Slow repairs','Deposit withheld','Mold','Pest issues','Entry without notice','Rent hikes','Hidden fees','Unreachable','Harassment'];

// Additional sample landlords near a big urban campus area (all invented).
window.LANDLORDS.push(
  { id:'larkspur', name:'Larkspur Student Housing', type:'Management company', city:'Los Angeles', state:'CA',
    properties:['2701 S Figueroa St','1100 W 28th St','3045 Menlo Ave'] },
  { id:'hoover9', name:'Hoover & Ninth Holdings', type:'Small portfolio', city:'Los Angeles', state:'CA',
    properties:['1239 W Jefferson Blvd','2630 S Hoover St'] },
  { id:'marlow', name:'Marlow Row Properties', type:'Individual owner', city:'Los Angeles', state:'CA',
    properties:['3601 S Flower St','2511 Portland St'] }
);
window.REVIEWS.push(
  ['larkspur','2701 S Figueroa St',2026,2,2,1,'living',false,['Slow repairs','Hidden fees'],
   'Rent includes a mandatory "community fee" that was not in the listing. The AC died in September and took three weeks to fix.',null],
  ['larkspur','1100 W 28th St',2025,3,2,3,'partial',true,['Hidden fees'],
   'Decent location, but they charged $450 to repaint the walls after one year. Deposit came back late.',null],
  ['larkspur','3045 Menlo Ave',2025,1,1,1,'withheld',false,['Deposit withheld','Unreachable','Pest issues'],
   'Cockroaches from day one. Office stopped answering email once I gave notice. No deposit back after 60 days.','All deposit disputes are handled according to California law. Contact our office with your forwarding address.'],
  ['larkspur','2701 S Figueroa St',2024,2,3,2,'partial',false,['Rent hikes'],
   'Rent jumped $240 at renewal. Maintenance is outsourced and slow.',null],
  ['hoover9','1239 W Jefferson Blvd',2026,4,5,4,'living',true,['Respectful','Quick fixes'],
   'Small landlord who actually picks up. Fixed a broken lock the same day.',null],
  ['hoover9','2630 S Hoover St',2025,5,5,5,'full',true,['Fair lease','Respectful'],
   'Straight lease, no surprise fees, full deposit back in under two weeks.',null],
  ['hoover9','1239 W Jefferson Blvd',2024,4,4,4,'full',true,['Fair lease'],
   'Honest and reasonable. Building is old but kept up.',null],
  ['marlow','3601 S Flower St',2026,2,1,2,'living',false,['Entry without notice','Slow repairs'],
   'Owner lets himself in to "check on things" with no warning. Leak under the sink took a month.',null],
  ['marlow','2511 Portland St',2025,3,3,3,'full',true,['Fair lease'],
   'Fine overall. Slow to respond but deposit was returned in full.',null],
  ['marlow','3601 S Flower St',2024,1,1,2,'withheld',false,['Deposit withheld','Entry without notice'],
   'Kept my whole deposit and refused to explain why.',null]
);
