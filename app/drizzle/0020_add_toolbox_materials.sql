CREATE TABLE `material_cost_items` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name_en` text NOT NULL,
  `name_es` text NOT NULL,
  `unit_en` text NOT NULL,
  `unit_es` text NOT NULL,
  `price` text NOT NULL DEFAULT '0.00',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `material_cost_items` (`name_en`,`name_es`,`unit_en`,`unit_es`,`price`,`created_at`,`updated_at`) VALUES
('2×4×8 lumber','Madera 2×4×8','each','cada una','4.25',unixepoch()*1000,unixepoch()*1000),
('4×8 plywood','Madera contrachapada 4×8','sheet','lámina','38.00',unixepoch()*1000,unixepoch()*1000),
('Drywall','Panel de yeso','sheet','lámina','15.00',unixepoch()*1000,unixepoch()*1000),
('80 lb concrete','Concreto de 80 lb','bag','bolsa','7.00',unixepoch()*1000,unixepoch()*1000),
('Paint','Pintura','gallon','galón','42.00',unixepoch()*1000,unixepoch()*1000),
('Primer','Imprimador','gallon','galón','32.00',unixepoch()*1000,unixepoch()*1000),
('Tile','Azulejo','sq ft','pie²','3.50',unixepoch()*1000,unixepoch()*1000),
('Thinset','Mortero adhesivo','bag','bolsa','22.00',unixepoch()*1000,unixepoch()*1000),
('Grout','Lechada','bag','bolsa','20.00',unixepoch()*1000,unixepoch()*1000),
('Shingles','Tejas','bundle','paquete','38.00',unixepoch()*1000,unixepoch()*1000),
('Roof underlayment','Base para techo','roll','rollo','75.00',unixepoch()*1000,unixepoch()*1000),
('Insulation batt','Aislante en manta','batt','manta','55.00',unixepoch()*1000,unixepoch()*1000),
('Romex 250 ft','Romex de 250 pies','roll','rollo','145.00',unixepoch()*1000,unixepoch()*1000),
('PVC pipe 10 ft','Tubo PVC de 10 pies','length','tramo','14.00',unixepoch()*1000,unixepoch()*1000),
('PEX fittings kit','Kit de conexiones PEX','kit','kit','48.00',unixepoch()*1000,unixepoch()*1000),
('Interior door slab','Puerta interior','each','cada una','95.00',unixepoch()*1000,unixepoch()*1000),
('Faucet','Grifo','each','cada uno','120.00',unixepoch()*1000,unixepoch()*1000),
('Vanity','Tocador','each','cada uno','450.00',unixepoch()*1000,unixepoch()*1000),
('Toilet','Inodoro','each','cada uno','220.00',unixepoch()*1000,unixepoch()*1000),
('Light fixture','Lámpara','each','cada una','85.00',unixepoch()*1000,unixepoch()*1000);
