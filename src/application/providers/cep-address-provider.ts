export interface CepAddress {
  street: string | null;
  neighborhood: string | null;
  city: string | null;
  uf: string | null;
}

export type AddressLookup =
  { status: 'found'; address: CepAddress } | { status: 'not_found' } | { status: 'unavailable' };

/** Never throws: unavailability is a result, so the use case decides how to degrade. */
export interface CepAddressProvider {
  lookup(cep: string): Promise<AddressLookup>;
}
