export interface CepAddress {
  street: string | null;
  neighborhood: string | null;
  city: string | null;
  uf: string | null;
}

export type AddressLookup =
  { status: 'found'; address: CepAddress } | { status: 'not_found' } | { status: 'unavailable' };

export interface CepAddressProvider {
  lookup(cep: string): Promise<AddressLookup>;
}
