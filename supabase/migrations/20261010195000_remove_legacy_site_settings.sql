-- Remove legacy settings that no longer drive any page or workflow.
-- Public team names are managed through team_positions; buffet configuration is
-- handled by the booking components workflow, not a generic site setting.
delete from public.site_settings
where key in (
  'booking_buffets',
  'team_food_grounds',
  'team_general_manager',
  'team_reception_manager',
  'team_swimming_coaches'
);
